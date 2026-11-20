"""Customer queue integration: synthetic source, clock, state and private locks."""
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
spec = importlib.util.spec_from_file_location("customer_turns", Path(__file__).with_name("sync_mgj_customer_profiles.py"))
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
REAL_GUARD = s.source_turns.customer_request
REAL_VERIFIED = s.source_turns.booking_protocol_verified
REAL_PENDING = s.source_turns.booking_pending


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.now = 0.0
        self.gate_held = False
        self.sleeps = []
        self.paths = {k: str(Path(self.temp.name) / k) for k in ("SOURCE_LOCK", "SESSION_LOCK", "COORDINATOR_LOCK", "BOOKING_LOCK")}
        self.patches = [mock.patch.object(s, k, v) for k, v in self.paths.items()]
        self.patches += [mock.patch.object(s, "RUN_DEADLINE", 105), mock.patch.object(s, "SOURCE_LAST_END", None),
                         mock.patch.object(s, "WAIT_USED", 0), mock.patch.object(s, "WAIT_EPISODES", 0),
                         mock.patch.object(s, "SESSION_SCOPES", {}), mock.patch.object(s, "log"),
                         mock.patch.object(s, "DEFERRED_PATH", str(Path(self.temp.name) / "deferred.json")),
                         mock.patch.object(s.time, "monotonic", side_effect=lambda: self.now),
                         mock.patch.object(s.time, "sleep", side_effect=self.sleep),
                         mock.patch.object(s, "load_config", return_value={"server": s.SERVER, "shop_id": "fixture-shop", "emp_id": "123", "cookies": "userId=fixture-user; JSESSIONID=fixture-cookie;"}),
                         mock.patch.object(s.source_turns, "booking_protocol_verified", return_value=True),
                         mock.patch.object(s.source_turns, "booking_pending", return_value=False),
                         mock.patch.object(s.source_turns, "customer_request", side_effect=self.guard),
                         mock.patch.object(s.subprocess, "check_output", side_effect=AssertionError("unmocked network forbidden"))]
        self.priority_patch = mock.patch.object(s, "source_priority_reason", return_value="")
        self.patches.append(self.priority_patch)
        for patch in self.patches: patch.start()

    def tearDown(self):
        for patch in reversed(self.patches): patch.stop()
        self.temp.cleanup()

    @contextmanager
    def guard(self):
        self.assertFalse(self.gate_held)
        self.gate_held = True
        try: yield
        finally: self.gate_held = False

    def assert_shared_unlocked(self):
        self.assertFalse(self.gate_held)
        for key in ("SESSION_LOCK", "SOURCE_LOCK", "BOOKING_LOCK"):
            with open(self.paths[key], "a") as handle:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def sleep(self, seconds):
        self.assert_shared_unlocked()
        self.sleeps.append(seconds)
        self.now += seconds

    def source(self):
        return s.form_post("consumerHelp!find.action", {"keyword": "synthetic-customer"})

    def response(self):
        def call(*args, **kwargs):
            self.assertTrue(self.gate_held)
            self.assertEqual(kwargs["timeout"], 10)
            for key in ("SESSION_LOCK", "SOURCE_LOCK"):
                with open(self.paths[key], "a") as handle:
                    with self.assertRaises(BlockingIOError): fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return b"fixture\n__MGJ_HTTP_STATUS__:200"
        return mock.patch.object(s.subprocess, "check_output", side_effect=call)

    def daily(self, **updates):
        today = datetime.now(timezone.utc).date().isoformat()
        state = {"status": "healthy", "pairs": {"fixture:" + today: {"success_at": s.time.time() - 1}}}
        state.update(updates)
        module = types.SimpleNamespace(TZ=timezone.utc, SHOPS=["fixture"], read_daily_sync_state=lambda: state,
                                       daily_sync_due=lambda value: False)
        return state, module

    def test_waits_past_twenty_seconds_for_booking_turn(self):
        with mock.patch.object(s, "source_priority_reason", side_effect=lambda: "booking_active" if self.now < 50 else ""), self.response() as call:
            self.assertEqual(self.source(), "fixture")
            self.assertEqual(call.call_count, 1)
        self.assertEqual(s.WAIT_USED, 50)
        self.assertEqual(self.now, 50)
        self.assert_shared_unlocked()

    def test_more_than_two_busy_episodes_can_make_progress(self):
        for _ in range(4):
            until = self.now + 3
            with mock.patch.object(s, "source_priority_reason", side_effect=lambda: "booking_active" if self.now < until else ""), self.response() as call:
                self.source()
                self.assertEqual(call.call_count, 1)
        self.assertEqual(s.WAIT_EPISODES, 4)
        self.assertEqual(s.WAIT_USED, 12)

    def test_continuous_busy_is_bounded_with_thirty_second_reserve(self):
        with mock.patch.object(s, "source_priority_reason", return_value="booking_active"), self.response() as call:
            with self.assertRaisesRegex(s.SourceDeferred, "source_budget"): self.source()
            call.assert_not_called()
        self.assertEqual(self.now, 75)
        self.assertEqual(sum(self.sleeps), 75)
        self.assertTrue(all(value == 1 for value in self.sleeps))
        self.assert_shared_unlocked()

    def test_daily_and_booking_wait_share_same_deadline(self):
        def priority():
            return "daily_due_or_cooling" if self.now < 30 else "booking_active" if self.now < 55 else ""
        with mock.patch.object(s, "source_priority_reason", side_effect=priority), mock.patch.object(s, "daily_wait_is_safe", return_value=True), self.response() as call:
            self.source()
            self.assertEqual(call.call_count, 1)
        self.assertEqual(self.now, 55)
        self.assertEqual(s.WAIT_USED, 55)

    def test_healthy_stale_daily_can_wait_but_never_send_while_stale(self):
        with mock.patch.object(s, "source_priority_reason", side_effect=lambda: "daily_due_or_cooling" if self.now < 25 else ""), mock.patch.object(s, "daily_wait_is_safe", return_value=True), self.response() as call:
            self.source()
            self.assertEqual(call.call_count, 1)
        self.assertEqual(self.now, 25)

    def test_failed_cooling_or_unknown_daily_is_not_polled(self):
        with mock.patch.object(s, "source_priority_reason", return_value="daily_due_or_cooling"), mock.patch.object(s, "daily_wait_is_safe", return_value=False), self.response() as call:
            with self.assertRaisesRegex(s.SourceDeferred, "daily_due_or_cooling"): self.source()
            call.assert_not_called()
        self.assertEqual(self.sleeps, [])

    def test_protocol_unverified_immediately_defers_without_gate(self):
        self.priority_patch.stop()
        _, daily = self.daily()
        with mock.patch.dict(sys.modules, {"sync_mgj_daily_electronic_sources": daily}), mock.patch.object(s.source_turns, "booking_protocol_verified", return_value=False), mock.patch.object(s.source_turns, "customer_request") as gate:
            with self.assertRaisesRegex(s.SourceDeferred, "source_turn_unsafe"): self.source()
            gate.assert_not_called()
        self.assertEqual(self.sleeps, [])

    def test_unsafe_request_guard_is_not_polled_or_sent(self):
        with mock.patch.object(s.source_turns, "customer_request", side_effect=s.source_turns.TurnUnsafe()), self.response() as call:
            with self.assertRaisesRegex(s.SourceDeferred, "source_turn_unsafe"): self.source()
            call.assert_not_called()
        self.assertEqual(self.sleeps, [])
        self.assert_shared_unlocked()

    def test_busy_guard_releases_other_locks_then_waits(self):
        n = 0
        def gate():
            nonlocal n
            n += 1
            if n <= 3: raise s.source_turns.TurnBusy()
            return self.guard()
        with mock.patch.object(s.source_turns, "customer_request", side_effect=gate), self.response() as call:
            self.source()
            self.assertEqual(call.call_count, 1)
        self.assertEqual(self.now, 3)
        self.assert_shared_unlocked()

    def test_new_booking_intent_after_guard_acquisition_prevents_send(self):
        values = iter(["", "", "booking_active"])
        with mock.patch.object(s, "source_priority_reason", side_effect=lambda: next(values, "")), self.response() as call:
            self.source()
            self.assertEqual(call.call_count, 1)
        self.assertEqual(self.now, 1)

    def test_daily_failure_arriving_inside_gate_prevents_send(self):
        values = iter(["", "", "daily_due_or_cooling"])
        with mock.patch.object(s, "source_priority_reason", side_effect=lambda: next(values, "daily_due_or_cooling")), mock.patch.object(s, "daily_wait_is_safe", return_value=False), self.response() as call:
            with self.assertRaisesRegex(s.SourceDeferred, "daily_due_or_cooling"): self.source()
            call.assert_not_called()
        self.assert_shared_unlocked()

    def test_cookie_is_read_after_long_wait_from_same_session_snapshot(self):
        def config(_):
            return {"shop_id": "fixture-shop", "emp_id": "123", "cookies": "userId=fixture-user; JSESSIONID=new;" if self.now else "userId=fixture-user; JSESSIONID=old;"}
        with mock.patch.object(s, "source_priority_reason", side_effect=lambda: "booking_active" if self.now < 24 else ""), mock.patch.object(s, "load_config", side_effect=config), self.response() as call:
            self.source()
            self.assertIn("Cookie: userId=fixture-user; JSESSIONID=new;", call.call_args.args[0])
            self.assertNotIn("Cookie: userId=fixture-user; JSESSIONID=old;", call.call_args.args[0])

    def test_request_timeout_is_not_replayed(self):
        with mock.patch.object(s.subprocess, "check_output", side_effect=subprocess.TimeoutExpired("fixture", 10)) as call:
            with self.assertRaisesRegex(s.SourceDeferred, "source_transport_incomplete"): self.source()
            self.assertEqual(call.call_count, 1)
        self.assertEqual(self.sleeps, [])
        self.assert_shared_unlocked()

    def test_429_stops_without_local_replay(self):
        with mock.patch.object(s.subprocess, "check_output", return_value=b"limited\n__MGJ_HTTP_STATUS__:429") as call:
            with self.assertRaises(s.SourceRateLimitError): self.source()
            self.assertEqual(call.call_count, 1)
        self.assertEqual(self.sleeps, [])
        self.assert_shared_unlocked()

    def test_request_gap_releases_all_shared_guards(self):
        with self.response(): self.source(); self.source()
        self.assertEqual(self.sleeps, [1])
        self.assertEqual(s.WAIT_USED, 0)

    def test_budget_exhausted_before_source_never_enters_guard(self):
        self.now = 76
        with mock.patch.object(s.source_turns, "customer_request") as gate, self.response() as call:
            with self.assertRaisesRegex(s.SourceDeferred, "source_budget"): self.source()
            gate.assert_not_called(); call.assert_not_called()

    def test_whole_booking_run_lock_does_not_block_verified_idle_source(self):
        self.priority_patch.stop()
        _, daily = self.daily()
        with mock.patch.dict(sys.modules, {"sync_mgj_daily_electronic_sources": daily}), open(self.paths["BOOKING_LOCK"], "a") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(s.source_priority_reason(), "")
            with mock.patch.object(s.source_turns, "booking_pending", return_value=True):
                self.assertEqual(s.source_priority_reason(), "booking_active")

    def test_daily_gate_precedes_protocol_and_rejects_bad_state(self):
        self.priority_patch.stop()
        state, daily = self.daily()
        invalid = [None, {}, {**state, "status": "degraded"}, {**state, "cooldown_until": s.time.time() + 60},
                   {**state, "cooldown_until": float("nan")}, {**state, "pairs": {}}, {**state, "pairs": []}]
        for value in invalid:
            daily.read_daily_sync_state = lambda value=value: value
            with mock.patch.dict(sys.modules, {"sync_mgj_daily_electronic_sources": daily}), mock.patch.object(s.source_turns, "booking_protocol_verified") as protocol:
                self.assertEqual(s.source_priority_reason(), "daily_due_or_cooling")
                protocol.assert_not_called()

    def test_review_and_future_retry_never_revived_by_progress(self):
        self.assertEqual(s.INCREMENTAL_RETRY_LIMIT, 2)
        stamp = datetime.now().astimezone().isoformat()
        deferred = [{"phone": "fixture-review", "deferred_since": stamp}, {"phone": "fixture-future", "deferred_since": stamp}, {"phone": "fixture-ready", "deferred_since": stamp}]
        queue = {"items": [{"phone": "fixture-review", "status": "needs_review"}, {"phone": "fixture-future", "status": "pending"}]}
        store = mock.Mock(); store.peek.return_value = {"completed_windows": 1, "created_at": 1}
        with mock.patch.object(s, "load_deferred", return_value={"items": deferred}), mock.patch.object(s, "eligible_retry_phones", return_value=[]), mock.patch.object(s, "history_resume_store", return_value=store):
            self.assertEqual(s.compensation_phones(queue), ["fixture-ready"])

    def test_actual_common_guard_checks_frozen_protocol_and_holds_gate(self):
        booking = Path(self.temp.name) / "booking-fixture.py"
        booking.write_bytes(b"# synthetic reviewed protocol\n")
        digest = hashlib.sha256(booking.read_bytes()).hexdigest()
        turns_root = Path(self.temp.name) / "turns"
        def source(*args, **kwargs):
            with open(turns_root / "request.lock", "rb") as handle:
                with self.assertRaises(BlockingIOError): fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return b"fixture\n__MGJ_HTTP_STATUS__:200"
        with mock.patch.object(s.source_turns, "ROOT", turns_root), mock.patch.object(s.source_turns, "BOOKING_PATH", booking), mock.patch.object(s.source_turns, "EXPECTED_BOOKING_SHA256", digest), mock.patch.object(s.source_turns, "booking_protocol_verified", side_effect=REAL_VERIFIED), mock.patch.object(s.source_turns, "booking_pending", side_effect=REAL_PENDING), mock.patch.object(s.source_turns, "customer_request", side_effect=REAL_GUARD), mock.patch.object(s.subprocess, "check_output", side_effect=source) as call:
            self.assertEqual(self.source(), "fixture")
            self.assertEqual(call.call_count, 1)
            booking.write_bytes(b"# changed unreviewed protocol\n")
            with self.assertRaisesRegex(s.SourceDeferred, "source_turn_unsafe"): self.source()
            self.assertEqual(call.call_count, 1)

    def test_malformed_daily_comparison_is_safe_priority_error(self):
        self.priority_patch.stop()
        state, daily = self.daily(cooldown_until="0")
        def bad_compare(value):
            return s.time.time() < value["cooldown_until"]
        daily.daily_sync_due = bad_compare
        with mock.patch.dict(sys.modules, {"sync_mgj_daily_electronic_sources": daily}):
            self.assertEqual(s.source_priority_reason(), "priority_state_unavailable")

    def test_unsafe_cleanup_after_sent_read_is_not_replayed(self):
        @contextmanager
        def guard():
            yield
            raise s.source_turns.TurnUnsafe("source_turn_lock_unavailable")
        with mock.patch.object(s.source_turns, "customer_request", side_effect=guard), mock.patch.object(s.subprocess, "check_output", return_value=b"fixture\n__MGJ_HTTP_STATUS__:200") as call:
            with self.assertRaisesRegex(s.SourceDeferred, "source_turn_unsafe"): self.source()
            self.assertEqual(call.call_count, 1)
        self.assertEqual(self.sleeps, [])
        self.assert_shared_unlocked()


if __name__ == "__main__":
    unittest.main()
