"""Offline integration: resume only checked work, never revive review items."""
import copy
from datetime import datetime, timedelta
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("customer_backlog", Path(__file__).with_name("sync_mgj_customer_profiles.py"))
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

SCOPE = {"host": s.SERVER, "customer_id": "fixture", "card_id": "1", "store_id": "fixture",
         "session_shop": "fixture", "session_user": "fixture", "session_employee": "fixture"}


class BacklogTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.today = datetime.now().date().isoformat()
        self.owner = s.history_owner_key("fixture")
        self.patches = [mock.patch.object(s, "HISTORY_RESUME_ROOT", str(self.root / "progress")),
                        mock.patch.object(s, "DEFERRED_PATH", str(self.root / "deferred.json")),
                        mock.patch.object(s, "HISTORY_START_DATE", "2024-01-01"),
                        mock.patch.object(s, "history_resume_scope", return_value=SCOPE),
                        mock.patch.object(s, "log"),
                        mock.patch.object(s, "multipart_post", side_effect=AssertionError("real source forbidden")),
                        mock.patch.object(s, "enrich_bill_history", side_effect=lambda row, *_a, **_k: row)]
        for patch in self.patches:
            patch.start()
        self.addCleanup(self.tmp.cleanup)
        for patch in self.patches:
            self.addCleanup(patch.stop)

    def fetch(self, detail_calls=0):
        receipt = {}
        rows = s.fetch_service_history("fixture", 1, "fixture", detail_calls,
                                       resume_owner=self.owner, resume_receipt=receipt)
        return rows, receipt

    def row(self, start, end):
        return {"id": start, "source_id": start, "date": end, "time": "12:00", "amount": 1}

    def read(self, _cust, _card, _shop, start, end, _config):
        return [self.row(start, end)]

    def test_deferral_keeps_validated_windows_and_next_run_continues(self):
        calls = []
        def interrupted(*args):
            calls.append((args[3], args[4]))
            if len(calls) == 2:
                raise s.SourceDeferred("booking_active")
            return self.read(*args)
        with mock.patch.object(s, "read_history_window", side_effect=interrupted):
            with self.assertRaises(s.SourceDeferred):
                self.fetch()
        state = s.history_resume_store().load(self.owner, SCOPE)
        self.assertEqual(len(state["windows"]), 1)
        self.assertIsNone(s.history_resume_store(read_only=True).peek(s.history_owner_key("other")))
        more = []
        def continued(*args):
            more.append((args[3], args[4]))
            return self.read(*args)
        with mock.patch.object(s, "read_history_window", side_effect=continued):
            rows, receipt = self.fetch()
        self.assertGreaterEqual(len(rows), 3)
        self.assertEqual(more[0], calls[1])
        self.assertEqual(receipt["owner"], self.owner)
        self.assertIsNotNone(s.history_resume_store().load(self.owner, SCOPE))

    def test_all_windows_and_summary_survive_detail_deferral(self):
        attempts = []
        def detail(row, *_args, **_kwargs):
            attempts.append(row["id"])
            if len(attempts) == 1:
                raise s.SourceDeferred("source_budget")
            return row
        with mock.patch.object(s, "read_history_window", side_effect=self.read), mock.patch.object(s, "enrich_bill_history", side_effect=detail):
            with self.assertRaises(s.SourceDeferred):
                self.fetch(2)
            state = s.history_resume_store().load(self.owner, SCOPE)
            frozen = state["enrichment_ids"]
            self.assertEqual(len(frozen), 1)  # Only newest within45 days; old details stay unrequested.
            rows, receipt = self.fetch(2)
        self.assertEqual(receipt["state"]["enrichment_ids"], frozen)
        self.assertEqual(attempts, frozen + frozen)
        self.assertTrue(rows)

    def test_cloud_failure_and_projection_failure_do_not_ack(self):
        with mock.patch.object(s, "read_history_window", side_effect=self.read):
            rows, receipt = self.fetch()
        data = {"phone": "fixture", "_history_complete": True, "_packages_complete": True,
                "_history_resume_receipt": receipt, "service_history": rows}
        with mock.patch.object(s, "supabase_get", return_value=[]), mock.patch.object(s, "supabase_post", side_effect=TimeoutError("fixture")):
            self.assertFalse(s.upsert_customer(data)[0])
        self.assertIsNotNone(s.history_resume_store().load(self.owner, SCOPE))
        with mock.patch.object(s, "supabase_get", return_value=[]), mock.patch.object(s, "supabase_post", return_value=204), mock.patch.object(s, "upsert_service_records", side_effect=TimeoutError("fixture")):
            self.assertFalse(s.upsert_customer(data)[0])
        self.assertIsNotNone(s.history_resume_store().load(self.owner, SCOPE))
        with mock.patch.object(s, "supabase_get", return_value=[]), mock.patch.object(s, "supabase_post", return_value=204) as write, mock.patch.object(s, "upsert_service_records", return_value=1):
            self.assertTrue(s.upsert_customer(data)[0])
        self.assertNotIn("_history_resume_receipt", write.call_args.args[1])
        self.assertIsNone(s.history_resume_store().load(self.owner, SCOPE))

    def test_partial_profile_never_acks_or_replaces_old_history(self):
        with mock.patch.object(s, "read_history_window", side_effect=self.read):
            rows, receipt = self.fetch()
        data = {"phone": "fixture", "_history_complete": False, "_packages_complete": True,
                "_history_resume_receipt": receipt, "service_history": rows}
        old = [{"id": "old", "date": self.today}]
        with mock.patch.object(s, "supabase_get", return_value=[{"id": 1, "service_history": old}]), mock.patch.object(s, "supabase_patch", return_value=204) as write, mock.patch.object(s, "upsert_service_records", return_value=0):
            self.assertFalse(s.upsert_customer(data)[0])
        self.assertEqual(write.call_args.args[1]["service_history"], old)
        self.assertIsNotNone(s.history_resume_store().load(self.owner, SCOPE))

    def test_progress_cannot_bypass_needs_review_or_retry_date(self):
        s.record_deferred(["review", "future", "due", "ordinary"], "source_budget")
        queue = {"items": [{"phone": "review", "status": "needs_review"},
                            {"phone": "future", "status": "pending", "next_retry_at": (datetime.now().astimezone() + timedelta(hours=1)).isoformat()},
                            {"phone": "due", "status": "pending"}]}
        before = copy.deepcopy(queue)
        with mock.patch.object(s.history_resume.HistoryResumeStore, "peek", return_value={"completed_windows": 1, "created_at": 1}):
            selected = s.compensation_phones(queue)
        self.assertEqual(set(selected), {"due", "ordinary"})
        self.assertEqual(queue, before)
        self.assertEqual(len(s.load_deferred()["items"]), 4)

    def test_at_most_one_existing_slot_prioritizes_active_progress(self):
        s.record_deferred(["old", "in-progress", "another"], "source_budget")
        queue = {"items": [{"phone": "retry", "status": "pending"}]}
        def peek(owner):
            return {"completed_windows": 2, "created_at": 1} if owner == s.history_owner_key("in-progress") else None
        with mock.patch.object(s.history_resume.HistoryResumeStore, "peek", side_effect=peek):
            self.assertEqual(s.compensation_phones(queue), ["in-progress", "retry"])

    def test_validate_uses_no_persistent_progress_or_queue_mutation(self):
        with mock.patch.object(s, "_get_customer_full", return_value={"found": False, "message": "fixture"}) as read, mock.patch.object(s, "record_deferred") as defer, mock.patch.object(s, "mark_deferred_attempt") as mark:
            self.assertFalse(s.validate_customer("fixture")["valid"])
        read.assert_called_once_with("fixture", s.HISTORY_DETAIL_CALLS, use_resume=False)
        defer.assert_not_called()
        mark.assert_not_called()
        self.assertFalse((self.root / "progress").exists())


if __name__ == "__main__":
    unittest.main()
