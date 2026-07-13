import importlib.util
import pathlib
import unittest


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


class SyncWindowTests(unittest.TestCase):
    def test_rotates_and_wraps_without_duplicates(self):
        phones = [f"phone-{index}" for index in range(7)]
        selected = SYNC.select_sync_window(phones, limit=3, slot=2)
        self.assertEqual(selected, ["phone-6", "phone-0", "phone-1"])
        self.assertEqual(len(selected), len(set(selected)))

    def test_keeps_short_list_unchanged(self):
        phones = ["a", "b"]
        self.assertEqual(SYNC.select_sync_window(phones, limit=3, slot=10), phones)


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
