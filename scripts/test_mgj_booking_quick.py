"""Isolated booking safety tests. All names, phones and IDs are synthetic."""

import copy
from datetime import datetime, timedelta
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from scripts import mgj_booking_core as core
from scripts import mgj_booking_quick as quick


NOW = datetime(2026, 10, 19, 9, 0, tzinfo=core.CHINA)


def request(**updates):
    value = dict(shop_id="1009951", customer_phone="13800000000", barber="合成老师",
                 services=["合成剪发", "合成染发"], start="2026-10-20T18:00:00+08:00", duration_minutes=120)
    value.update(updates)
    return core.Request.parse(value)


def snapshot():
    return dict(complete=True, shop_id="1009951", fetched_at=NOW.isoformat(),
                window_start="2026-10-19T00:00:00+08:00", window_end="2026-10-22T00:00:00+08:00",
                customers=[dict(id="c1", shop_id="1009951", phone="13800000000", active=True)],
                barbers=[dict(id="b1", shop_id="1009951", name="合成老师", active=True)],
                services=[dict(id="s1", shop_id="1009951", name="合成剪发", active=True),
                          dict(id="s2", shop_id="1009951", name="合成染发", active=True)], bookings=[])


def row(identity, **updates):
    value = dict(identity, id="synthetic-booking-1", state="active")
    value.update(updates)
    return value


class SyntheticGateway:
    write_verified = True  # Test double only. No HTTP, adapter loading or live settings.

    def __init__(self, data=None, behavior="success"):
        self.data = data or snapshot()
        self.behavior = behavior
        self.writes = 0
        self.reads = 0

    def snapshot(self, request):
        self.reads += 1
        if self.behavior == "readback_failure" and self.writes:
            raise TimeoutError("synthetic failure")
        return copy.deepcopy(self.data)

    def create_once(self, identity):
        self.writes += 1
        if self.behavior == "crash":
            raise KeyboardInterrupt()
        if self.behavior != "timeout_before":
            self.data["bookings"].append(row(identity))
        if self.behavior.startswith("timeout"):
            raise TimeoutError("synthetic secret must not be logged")
        return {"booking_id": "wrong-id" if self.behavior == "wrong_id" else "synthetic-booking-1"}


class SafetyTests(unittest.TestCase):
    def setUp(self):
        self.no_network = mock.patch("socket.socket", side_effect=AssertionError("network forbidden in isolated tests"))
        self.no_network.start()
        self.addCleanup(self.no_network.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.journal = core.Journal(Path(self.temp.name) / "journal")
        self.req = request()
        self.data = snapshot()
        self.plan = core.prepare(self.req, self.data, NOW)

    def run_booking(self, gateway, req=None, plan=None, clock=lambda: NOW):
        plan = plan or self.plan
        return core.execute(req or self.req, plan, plan.confirmation, gateway, self.journal, clock)

    def test_exact_phone_and_timezone(self):
        normalized = request(customer_phone="+86 138-0000-0000", start="2026-10-20T10:00:00+00:00")
        self.assertEqual(normalized, self.req)
        for number in ("0000", "138****0000", "not-a-number"):
            with self.subTest(number=number), self.assertRaises(core.Blocked):
                request(customer_phone=number)

    def test_missing_duration_or_timezone_is_not_guessed(self):
        for changes in ({"duration_minutes": 0}, {"duration_minutes": True},
                        {"start": "2026-10-20T18:00"}, {"start": "2026-10-20T18:00:01+08:00"}):
            with self.subTest(changes=changes), self.assertRaises(core.Blocked):
                request(**changes)

    def test_unique_customer_staff_and_services_required(self):
        for field in ("customers", "barbers", "services"):
            data = snapshot()
            duplicate = dict(data[field][0], id="another-id")
            data[field].append(duplicate)
            with self.subTest(field=field), self.assertRaises(core.Blocked):
                core.prepare(self.req, data, NOW)

    def test_no_cross_shop_or_partial_or_stale(self):
        for updates in ({"shop_id": "1837032"}, {"complete": False},
                        {"fetched_at": (NOW - timedelta(seconds=61)).isoformat()},
                        {"fetched_at": (NOW + timedelta(seconds=10)).isoformat()}):
            with self.subTest(updates=updates), self.assertRaises(core.Blocked):
                core.prepare(self.req, dict(self.data, **updates), NOW)

    def test_cross_midnight_requires_full_coverage(self):
        req = request(start="2026-10-20T23:30:00+08:00")
        self.data["window_end"] = "2026-10-21T00:00:00+08:00"
        with self.assertRaises(core.Blocked):
            core.prepare(req, self.data, NOW)

    def test_exact_duplicate_does_not_write_even_without_writer(self):
        gateway = SyntheticGateway()
        gateway.write_verified = False
        gateway.data["bookings"] = [row(self.plan.identity)]
        result = self.run_booking(gateway)
        self.assertEqual(result["status"], "exists")
        self.assertEqual(gateway.writes, 0)

    def test_same_customer_slot_different_service_never_creates(self):
        self.data["bookings"] = [row(self.plan.identity, service_ids=["s1"])]
        self.assertEqual(core.prepare(self.req, self.data, NOW).status, "needs_review")

    def test_multiple_identical_appointments_require_review(self):
        self.data["bookings"] = [row(self.plan.identity), row(self.plan.identity, id="synthetic-2")]
        self.assertEqual(core.prepare(self.req, self.data, NOW).status, "needs_review")

    def test_stylist_and_customer_overlaps_are_blocked(self):
        for changes in ({"customer_id": "c2", "customer_phone": "13900000000"}, {"barber_id": "b2"}):
            self.data["bookings"] = [row(self.plan.identity, start="2026-10-20T17:00:00+08:00", **changes)]
            with self.subTest(changes=changes):
                self.assertEqual(core.prepare(self.req, self.data, NOW).status, "needs_review")

    def test_boundary_is_half_open_and_cancellation_is_explicit(self):
        self.data["bookings"] = [row(self.plan.identity, start="2026-10-20T16:00:00+08:00", end=self.req.start)]
        self.assertEqual(core.prepare(self.req, self.data, NOW).status, "ready")
        self.data["bookings"] = [row(self.plan.identity, state="cancelled")]
        self.assertEqual(core.prepare(self.req, self.data, NOW).status, "ready")

    def test_unknown_status_and_missing_end_do_not_mean_free(self):
        for changes in ({"state": "unmapped"}, {"end": None}):
            self.data["bookings"] = [row(self.plan.identity, **changes)]
            with self.subTest(changes=changes):
                self.assertEqual(core.prepare(self.req, self.data, NOW).status, "needs_review")

    def test_success_requires_matching_readback_and_replay_is_read_only(self):
        gateway = SyntheticGateway()
        self.assertEqual(self.run_booking(gateway)["status"], "confirmed_readback")
        self.assertEqual(self.run_booking(gateway)["status"], "exists")
        self.assertEqual(gateway.writes, 1)
        self.assertEqual((self.journal.directory / "journal.json").stat().st_mode & 0o777, 0o600)
        journal = (self.journal.directory / "journal.json").read_text()
        self.assertNotIn(self.req.customer_phone, journal)

    def test_verified_adapter_required(self):
        gateway = SyntheticGateway()
        gateway.write_verified = False
        with self.assertRaisesRegex(core.Blocked, "接口尚未验证"):
            self.run_booking(gateway)
        self.assertEqual(gateway.writes, 0)

    def test_confirmation_changed_or_expired_is_rejected_before_write(self):
        gateway = SyntheticGateway()
        with self.assertRaises(core.Blocked):
            core.execute(self.req, self.plan, "wrong", gateway, self.journal, lambda: NOW)
        with self.assertRaises(core.Blocked):
            self.run_booking(gateway, clock=lambda: NOW + timedelta(seconds=61))
        self.assertEqual(gateway.writes, 0)

    def test_identity_changed_between_plan_and_commit_requires_confirmation(self):
        gateway = SyntheticGateway()
        gateway.data["barbers"][0]["id"] = "b-other"
        with self.assertRaisesRegex(core.Blocked, "发生变化"):
            self.run_booking(gateway)
        self.assertEqual(gateway.writes, 0)

    def test_conflict_added_after_confirmation_is_rechecked(self):
        gateway = SyntheticGateway()
        gateway.data["bookings"] = [row(self.plan.identity, customer_id="another", customer_phone="13900000000")]
        with self.assertRaises(core.Blocked):
            self.run_booking(gateway)
        self.assertEqual(gateway.writes, 0)

    def test_timeout_after_server_commit_recovers_by_readback_not_resend(self):
        gateway = SyntheticGateway(behavior="timeout_after")
        self.assertEqual(self.run_booking(gateway)["status"], "confirmed_readback")
        self.assertEqual(self.run_booking(gateway)["status"], "exists")
        self.assertEqual(gateway.writes, 1)

    def test_timeout_before_commit_blocks_every_retry(self):
        gateway = SyntheticGateway(behavior="timeout_before")
        for _ in range(2):
            with self.assertRaises(core.Blocked):
                self.run_booking(gateway)
        self.assertEqual(gateway.writes, 1)

    def test_uncertain_attempt_cannot_be_bypassed_by_changing_project_or_time(self):
        gateway = SyntheticGateway(behavior="timeout_before")
        with self.assertRaises(core.Blocked):
            self.run_booking(gateway)
        for req in (request(services=["合成剪发"]), request(start="2026-10-20T20:30:00+08:00")):
            plan = core.prepare(req, gateway.data, NOW)
            with self.assertRaises(core.Blocked):
                self.run_booking(gateway, req, plan)
        self.assertEqual(gateway.writes, 1)

    def test_crash_after_durable_intent_does_not_retry(self):
        gateway = SyntheticGateway(behavior="crash")
        with self.assertRaises(KeyboardInterrupt):
            self.run_booking(gateway)
        with self.assertRaises(core.Blocked):
            self.run_booking(gateway)
        self.assertEqual(gateway.writes, 1)

    def test_wrong_response_id_or_failed_readback_never_reports_success(self):
        for behavior in ("wrong_id", "readback_failure"):
            self.journal = core.Journal(Path(self.temp.name) / behavior)
            gateway = SyntheticGateway(behavior=behavior)
            with self.subTest(behavior=behavior), self.assertRaises(core.Blocked):
                self.run_booking(gateway)
            self.assertEqual(gateway.writes, 1)

    def test_wrong_response_id_cannot_be_erased_by_a_later_read(self):
        gateway = SyntheticGateway(behavior="wrong_id")
        for _ in range(2):
            with self.assertRaises(core.Blocked):
                self.run_booking(gateway)
        self.assertEqual(gateway.writes, 1)

    def test_missing_booking_identity_cannot_look_like_a_free_slot(self):
        for changes in ({"barber_id": None}, {"customer_phone": ""}, {"customer_id": None}):
            self.data["bookings"] = [row(self.plan.identity, **changes)]
            with self.subTest(changes=changes):
                self.assertEqual(core.prepare(self.req, self.data, NOW).status, "needs_review")

    def test_equivalent_customer_phone_forms_still_detect_ambiguity(self):
        self.data["customers"].append(dict(self.data["customers"][0], id="c-other", phone="+86 13800000000"))
        with self.assertRaises(core.Blocked):
            core.prepare(self.req, self.data, NOW)

    def test_corrupt_journal_does_not_reset(self):
        with self.journal.locked():
            (self.journal.directory / "journal.json").write_text("broken")
            os.chmod(self.journal.directory / "journal.json", 0o600)
        gateway = SyntheticGateway()
        with self.assertRaises(core.Blocked):
            self.run_booking(gateway)
        self.assertEqual(gateway.writes, 0)

    def test_local_concurrent_calls_fail_without_write(self):
        with self.journal.locked():
            with self.assertRaisesRegex(core.Blocked, "正在运行"):
                self.run_booking(SyntheticGateway())

    def test_preview_redacts_phone(self):
        self.assertNotIn(self.req.customer_phone, json.dumps(self.plan.public()))


class SourceReaderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "session.json"
        self.path.write_text(json.dumps(dict(server="vip12.meiguanjia.net", cookies="JSESSIONID=synthetic")))
        os.chmod(self.path, 0o600)

    def test_unverified_endpoint_is_blocked_before_network(self):
        reader = quick.SourceReader(self.path)
        with mock.patch.object(reader.opener, "open") as network:
            with self.assertRaises(core.Blocked):
                reader.read("unverified-create-endpoint", {})
            network.assert_not_called()

    def test_canonical_read_parameters_and_metadata_do_not_renew_session(self):
        reader = quick.SourceReader(self.path)
        before = self.path.read_bytes()
        with mock.patch.object(reader, "read", side_effect=[{"code": 0, "content": {"synthetic": []}},
                {"code": 0, "content": {"reservations": []}}, "no matches"]) as read:
            result = reader.inspect(quick.select_shop("自由手艺人"), "2026-10-20", "13800000000")
        self.assertFalse(result["live_write_available"])
        payload = json.loads(read.call_args_list[1].args[1]["jsonObj"])
        self.assertEqual(payload["shopId"], "1009951")
        self.assertEqual(payload["parentShopId"], "1103470")
        self.assertEqual(read.call_args_list[2].args[1]["keyword"], "13800000000")
        self.assertEqual(self.path.read_bytes(), before)

    def test_missing_list_is_not_empty_success(self):
        reader = quick.SourceReader(self.path)
        with mock.patch.object(reader, "read", side_effect=[{"code": 0}, {"code": 0, "content": {}}]):
            with self.assertRaises(core.Blocked):
                reader.inspect(quick.select_shop("自由手艺人"), "2026-10-20")

    def test_unsafe_config_host_and_permissions_blocked(self):
        self.path.write_text(json.dumps(dict(server="example.invalid", cookies="synthetic")))
        with self.assertRaises(core.Blocked):
            quick.SourceReader(self.path)
        os.chmod(self.path, 0o644)
        with self.assertRaises(core.Blocked):
            quick.SourceReader(self.path)

    def test_network_error_is_redacted_and_not_retried(self):
        reader = quick.SourceReader(self.path)
        with mock.patch.object(reader.opener, "open", side_effect=TimeoutError("synthetic-cookie-secret")) as call:
            with self.assertRaises(core.Blocked) as error:
                reader.read("metedata!reservationMetadata.action")
            self.assertNotIn("synthetic-cookie-secret", str(error.exception))
            self.assertEqual(call.call_count, 1)

    def test_redirects_never_forward_cookies(self):
        with self.assertRaises(core.Blocked):
            quick.NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.invalid/")

    def test_doctor_reports_missing_session_without_network(self):
        with mock.patch("socket.socket", side_effect=AssertionError("network forbidden")):
            result = quick.doctor(Path(self.temp.name) / "missing")
        self.assertFalse(result["session_file_present"])
        self.assertFalse(result["live_write_available"])

    def test_cli_has_no_create_or_enable_write_command(self):
        with mock.patch("sys.stderr", io.StringIO()), self.assertRaises(SystemExit):
            quick.main(["create"])


if __name__ == "__main__":
    unittest.main()
