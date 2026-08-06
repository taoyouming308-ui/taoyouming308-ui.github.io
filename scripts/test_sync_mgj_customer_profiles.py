import importlib.util
import pathlib
import tempfile
import unittest
import urllib.error
from datetime import datetime, timedelta, timezone
from unittest import mock


SCRIPT_PATH = pathlib.Path(__file__).with_name("sync_mgj_customer_profiles.py")
SPEC = importlib.util.spec_from_file_location("sync_mgj_customer_profiles", SCRIPT_PATH)
SYNC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SYNC)


class MergeProfileTests(unittest.TestCase):
    def setUp(self):
        self.existing = {
            "phone": "18626895050",
            "name": "张小姐",
            "shop_name": "自由手艺人",
            "barber_name": "无名",
            "total_visits": 17,
            "total_consumption": 12410,
            "last_visit_date": "2026-06-25 20:41",
            "card_packages": [{"id": "p1", "name": "酸护套餐", "left": 2, "total": 4}],
            "service_history": [{
                "id": "b1",
                "source_id": "b1",
                "date": "2026-06-25",
                "time": "20:41",
                "items": [{"name": "酸护套餐"}],
                "barber": "无名",
            }],
            "notes": "老客户备注",
        }

    def test_partial_failure_never_erases_arrays(self):
        incoming = {
            "phone": "18626895050",
            "name": "张小姐",
            "card_packages": [],
            "service_history": [],
            "_packages_complete": False,
            "_history_complete": False,
        }
        merged = SYNC.merge_profile(self.existing, incoming)
        self.assertEqual(merged["card_packages"], self.existing["card_packages"])
        self.assertEqual(merged["service_history"], self.existing["service_history"])
        self.assertEqual(merged["total_visits"], 17)

    def test_authoritative_empty_packages_can_clear_used_packages(self):
        incoming = {
            "phone": "18626895050",
            "card_packages": [],
            "_packages_complete": True,
            "_history_complete": False,
        }
        merged = SYNC.merge_profile(self.existing, incoming)
        self.assertEqual(merged["card_packages"], [])

    def test_history_deduplicates_and_keeps_existing_detail(self):
        incoming = {
            "phone": "18626895050",
            "service_history": [{
                "id": "b1",
                "source_id": "b1",
                "date": "2026-06-25",
                "time": "20:41",
                "items": [],
                "amount": 0,
            }],
            "_packages_complete": False,
            "_history_complete": True,
        }
        merged = SYNC.merge_profile(self.existing, incoming)
        self.assertEqual(len(merged["service_history"]), 1)
        self.assertEqual(merged["service_history"][0]["items"], [{"name": "酸护套餐"}])
        self.assertEqual(merged["service_history"][0]["barber"], "无名")

    def test_notes_preserve_existing_content(self):
        incoming = {
            "phone": "18626895050",
            "avg_fee": 730,
            "source_customer_id": "162098687",
            "_packages_complete": False,
            "_history_complete": False,
        }
        merged = SYNC.merge_profile(self.existing, incoming)
        self.assertIn("老客户备注", merged["notes"])
        self.assertIn("均消¥730", merged["notes"])
        self.assertIn("美管加客户ID:162098687", merged["notes"])

    def test_backfill_mode_preserves_all_existing_nonempty_fields(self):
        incoming = {
            "phone": "18626895050",
            "name": "新名字",
            "total_visits": 99,
            "total_consumption": 99999,
            "card_packages": [{"id": "new"}],
            "service_history": [{"id": "new"}],
            "_packages_complete": True,
            "_history_complete": True,
        }
        merged = SYNC.merge_profile(self.existing, incoming, fill_missing_only=True)
        self.assertEqual(merged["name"], "张小姐")
        self.assertEqual(merged["total_visits"], 17)
        self.assertEqual(merged["total_consumption"], 12410)
        self.assertEqual(merged["card_packages"], self.existing["card_packages"])
        self.assertEqual(merged["service_history"], self.existing["service_history"])

    def test_backfill_mode_fills_empty_arrays(self):
        existing = dict(self.existing)
        existing["card_packages"] = []
        existing["service_history"] = []
        incoming = {
            "phone": "18626895050",
            "card_packages": [{"id": "p2", "name": "剪发卡"}],
            "service_history": [{"id": "b2", "date": "2026-06-28"}],
            "_packages_complete": True,
            "_history_complete": True,
        }
        merged = SYNC.merge_profile(existing, incoming, fill_missing_only=True)
        self.assertEqual(merged["card_packages"][0]["id"], "p2")
        self.assertEqual(merged["service_history"][0]["id"], "b2")


class MemberCardSelectionTests(unittest.TestCase):
    def test_skips_default_empty_card_when_customer_has_multiple_cards(self):
        cards = [
            {"id": 100, "cardtypeid": "20151212"},
            {"id": 200, "cardtypeid": "VIP"},
        ]
        self.assertEqual(SYNC.choose_member_card(cards, 999), 200)

    def test_uses_first_normal_card(self):
        cards = [{"id": 300, "cardtypeid": "VIP"}, {"id": 400, "cardtypeid": "OTHER"}]
        self.assertEqual(SYNC.choose_member_card(cards, 999), 300)

    def test_uses_search_fallback_when_detail_has_no_cards(self):
        self.assertEqual(SYNC.choose_member_card([], 999), 999)


class HistorySessionRoutingTests(unittest.TestCase):
    @mock.patch.object(SYNC, "multipart_post")
    @mock.patch.object(SYNC, "session_shop_id", return_value="1009951")
    def test_bill_history_uses_isolated_read_only_session(self, session_shop_id, post):
        post.return_value = {"code": 0, "content": []}
        config_path = "/tmp/read-only-history-session.json"

        self.assertEqual(
            SYNC.fetch_service_history(
                "customer-1",
                123,
                "1837032",
                detail_calls=0,
                config_path=config_path,
            ),
            [],
        )
        session_shop_id.assert_called_once_with(config_path)
        self.assertEqual(post.call_args.kwargs["config_path"], config_path)

    def test_recent_bill_rotation_does_not_waste_calls_on_old_history(self):
        history = [
            {"id": "newest", "date": "2026-07-30"},
            {"id": "recent-1", "date": "2026-07-20"},
            {"id": "recent-2", "date": "2026-07-15"},
            {"id": "old", "date": "2025-01-01"},
        ]
        indexes = SYNC.select_history_detail_indexes(
            history,
            detail_calls=2,
            recent_days=45,
            slot=1,
            today=SYNC.datetime(2026, 7, 30).date(),
        )
        self.assertEqual(indexes[0], 0)
        self.assertIn(indexes[1], (1, 2))
        self.assertNotIn(3, indexes)

    def test_service_refresh_can_enrich_multiple_recent_bills_per_customer(self):
        history = [
            {"id": f"bill-{index}", "date": f"2026-07-{30-index:02d}"}
            for index in range(10)
        ]
        indexes = SYNC.select_history_detail_indexes(
            history,
            detail_calls=8,
            recent_days=45,
            slot=0,
            today=SYNC.datetime(2026, 7, 30).date(),
        )
        self.assertEqual(len(indexes), 8)
        self.assertEqual(len(indexes), len(set(indexes)))


class SessionIdentityTests(unittest.TestCase):
    def test_reads_employee_id_from_current_session_cookie(self):
        with mock.patch.object(SYNC, "load_config", return_value={}), \
             mock.patch.object(SYNC, "load_cookies", return_value="JSESSIONID=x; userId=831819; shopId=1009951"):
            self.assertEqual(SYNC.session_employee_id(), "831819")

    def test_explicit_employee_id_overrides_cookie(self):
        with mock.patch.object(SYNC, "load_config", return_value={"emp_id": "900001"}), \
             mock.patch.object(SYNC, "load_cookies", return_value="userId=831819"):
            self.assertEqual(SYNC.session_employee_id(), "900001")


class SyncWindowTests(unittest.TestCase):
    def test_incremental_batch_fits_hermes_execution_window(self):
        self.assertEqual(SYNC.INCREMENTAL_SYNC_LIMIT, 8)

    def test_rotates_and_wraps_without_duplicates(self):
        phones = [f"phone-{index}" for index in range(7)]
        selected = SYNC.select_sync_window(phones, limit=3, slot=2)
        self.assertEqual(selected, ["phone-6", "phone-0", "phone-1"])
        self.assertEqual(len(selected), len(set(selected)))

    def test_retry_customers_consume_capacity_without_exceeding_batch_limit(self):
        retry_phones = ["retry-1", "retry-2"]
        normal = SYNC.select_sync_window(
            [f"normal-{index}" for index in range(10)],
            limit=SYNC.INCREMENTAL_SYNC_LIMIT - len(retry_phones),
            slot=0,
        )
        self.assertEqual(len(retry_phones + normal), SYNC.INCREMENTAL_SYNC_LIMIT)

    def test_keeps_short_list_unchanged(self):
        phones = ["a", "b"]
        self.assertEqual(SYNC.select_sync_window(phones, limit=3, slot=10), phones)

    def test_service_refresh_reserves_capacity_for_hair_form_customers(self):
        selected = SYNC.select_service_refresh_phones(
            ["hair-1", "hair-2", "hair-3"],
            ["booking-1", "hair-1", "booking-2"],
            limit=3,
            slot=0,
        )
        self.assertEqual(len(selected), 3)
        self.assertEqual(len([phone for phone in selected if phone.startswith("hair-")]), 2)
        self.assertEqual(len(selected), len(set(selected)))


class NetworkRetryTests(unittest.TestCase):
    def tearDown(self):
        SYNC.RUN_DEADLINE = None

    @mock.patch.object(SYNC.time, "sleep")
    def test_transient_timeout_retries_then_succeeds(self, sleep):
        operation = mock.Mock(side_effect=[TimeoutError("slow"), {"ok": True}])
        self.assertEqual(SYNC.with_network_retries(operation, 10), {"ok": True})
        self.assertEqual(operation.call_count, 2)
        sleep.assert_called_once_with(1)

    @mock.patch.object(SYNC.time, "sleep")
    def test_non_transient_http_error_is_not_retried(self, sleep):
        error = urllib.error.HTTPError("https://example.invalid", 400, "bad", {}, None)
        operation = mock.Mock(side_effect=error)
        try:
            with self.assertRaises(urllib.error.HTTPError):
                SYNC.with_network_retries(operation, 10)
            self.assertEqual(operation.call_count, 1)
            sleep.assert_not_called()
        finally:
            error.close()


class RetryQueueTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 8, 6, 18, 0, tzinfo=timezone(timedelta(hours=8)))

    def test_failure_is_persisted_and_success_removes_it(self):
        queue = SYNC.update_retry_queue(
            {"version": 1, "items": []},
            [{"phone": "13800000000", "success": False, "error": "timeout"}],
            now=self.now,
        )
        self.assertEqual(queue["items"][0]["attempts"], 1)
        self.assertEqual(queue["items"][0]["status"], "pending")
        recovered = SYNC.update_retry_queue(
            queue,
            [{"phone": "13800000000", "success": True}],
            now=self.now,
        )
        self.assertEqual(recovered["items"], [])

    def test_fifth_failure_requires_manual_review(self):
        queue = {
            "version": 1,
            "items": [{
                "phone": "13800000000",
                "attempts": 4,
                "status": "pending",
                "first_failed_at": self.now.isoformat(),
            }],
        }
        updated = SYNC.update_retry_queue(
            queue,
            [{"phone": "13800000000", "success": False, "error": "still failing"}],
            now=self.now,
        )
        self.assertEqual(updated["items"][0]["status"], "needs_review")
        self.assertNotIn("next_retry_at", updated["items"][0])

    def test_queue_file_is_private_and_atomic(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "queue.json"
            SYNC.save_retry_queue({"version": 1, "items": []}, str(path))
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_corrupt_queue_is_not_silently_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "queue.json"
            path.write_text("not-json", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "补偿队列不可读"):
                SYNC.load_retry_queue(str(path))
            self.assertEqual(path.read_text(encoding="utf-8"), "not-json")


class BookingPhoneQueryTests(unittest.TestCase):
    @mock.patch.object(SYNC, "supabase_get", side_effect=TimeoutError("offline"))
    def test_all_phone_sources_failing_is_not_reported_as_empty_success(self, get):
        with self.assertRaisesRegex(RuntimeError, "预约手机号查询全部失败"):
            SYNC.get_booking_phones(days_back=1, days_forward=2)
        self.assertEqual(get.call_count, 2)

    def test_expired_budget_skips_without_calling_customer_api(self):
        SYNC.RUN_DEADLINE = SYNC.time.monotonic() - 1
        try:
            with mock.patch.object(SYNC, "get_customer_full") as fetch:
                ok, fail, skipped, outcomes = SYNC.sync_phones(["a", "b"])
            self.assertEqual((ok, fail, skipped), (0, 0, 2))
            self.assertTrue(all(item["skipped"] for item in outcomes))
            fetch.assert_not_called()
        finally:
            SYNC.RUN_DEADLINE = None


class ServiceReconciliationTests(unittest.TestCase):
    def test_classifies_perm_dye_and_care_from_bill_items(self):
        item = {"items": [
            {"name": "热塑烫"},
            {"name": "健康染"},
            {"name": "歌薇酸性护理"},
        ]}
        self.assertEqual(SYNC.service_types_for_history(item), ["perm", "dye", "care"])

    def test_does_not_guess_from_bill_without_line_items(self):
        item = {"comment": "顾客可能做了烫发", "items": []}
        self.assertEqual(SYNC.service_types_for_history(item), [])

    def test_builds_stable_reconciliation_row(self):
        profile = {
            "phone": "18626895050",
            "name": "张小姐",
            "shop_name": "自由手艺人",
            "service_history": [{
                "source_id": "bill-1",
                "bill_no": "MGJ001",
                "date": "2026-07-14",
                "time": "18:20",
                "amount": 680,
                "shop": "自由手艺人",
                "staff": ["无名", "技师甲"],
                "items": [{"name": "热塑烫", "quantity": 1}],
            }],
        }
        rows = SYNC.build_service_records(profile)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["source_id"], "bill-1")
        self.assertEqual(rows[0]["service_types"], ["perm"])
        self.assertEqual(rows[0]["customer_phone"], "18626895050")


if __name__ == "__main__":
    unittest.main()
