import copy
import json
import unittest

from scripts import mgj_business_detail as business
from scripts.mgj_employee_identity import employee_index, EmployeeIdentityError


def fixture():
    return {
        "id": "42", "shopid": "1837032", "consumetime": "2026-01-01 10:00:00",
        "type": 0, "status": 0, "eafee": "100.00", "money": 100,
        "customerName": "PRIVATE_CUSTOMER", "phone": "PRIVATE_PHONE",
        "details": [{"id": 8, "itemno": "H1", "itemname": "剪发", "depcode": "D1",
                     "depcodename": "剪发", "num": 1, "money": 100, "price": 100}],
        "empList": [{"id": 0, "employeeId": 0, "empId": 21, "dutyname": "设计师"},
                    {"id": 0, "employeeId": 0, "empId": 22, "dutyname": "C级技师"}],
        "empfees": [{"id": 81, "empid": 21, "empname": "TEST_STYLIST", "detailId": 8,
                     "fee": 100, "cashFee": 80, "cardFee": 20, "otherFee": 0, "projectCount": 1},
                    {"id": 82, "empid": 22, "empname": "TEST_TECH", "detailId": 8,
                     "fee": 100, "cashFee": 80, "cardFee": 20, "otherFee": 0, "projectCount": 1}],
        "payConfigs": [{"field": "CASH", "fieldName": "现金"}],
        "paydetail": {"cash": 80, "cardfee": 20},
        "cashList": [{"cash": 80}, {"cash": 80}],
    }


def normalized(value=None):
    return business.normalize_bill(fixture() if value is None else value,
                                   bill_id="42", shop="1837032", day="2026-01-01")


class BusinessDetailTests(unittest.TestCase):
    def test_placeholder_ids_do_not_merge_staff(self):
        result = normalized()
        self.assertEqual([r["employee_id"] for r in result["employee_allocations"]], ["21", "22"])
        self.assertEqual([r["source_role"] for r in result["employee_allocations"]], ["设计师", "C级技师"])

    def test_payment_and_performance_cannot_double_revenue(self):
        result = normalized()
        self.assertEqual(result["source_posted_amount_cents"], 10000)
        self.assertEqual(sum(r["performance_cents"] for r in result["employee_allocations"]), 20000)
        payments = {r["source_field"]: r for r in result["payments"]}
        self.assertEqual(payments["cash"]["amount_cents"], 8000)
        self.assertEqual(payments["cardfee"]["amount_cents"], 2000)
        self.assertNotIn("cashList", result)

    def test_missing_is_not_zero_and_four_user_fields_are_not_applicable(self):
        result = normalized()
        self.assertIn("payment_fields_missing", result["gaps"])
        self.assertIsNone(next(r["amount_cents"] for r in result["payments"] if r["source_field"] == "weixin"))
        self.assertEqual(len(result["not_applicable_report_fields"]), 4)
        self.assertFalse(result["report_ready"])

    def test_wrong_shop_day_or_id_is_rejected(self):
        for key, value in [("shopid", "1009951"), ("id", "43"), ("consumetime", "2026-01-02")]:
            source = fixture()
            source[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                normalized(source)

    def test_amounts_are_exact_and_invalid_values_fail(self):
        self.assertEqual(business.money_cents("0.29"), 29)
        self.assertEqual(business.money_cents("-0.29"), -29)
        for value in (True, "NaN", "Infinity", 0.001, {}, "90071992547410"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                business.money_cents(value)

    def test_primary_id_conflicts_fail(self):
        with self.assertRaises(EmployeeIdentityError):
            employee_index([{"empId": 1, "dutyname": "A"}, {"empId": 1, "dutyname": "B"}])

    def test_source_float_residue_does_not_block_the_whole_day(self):
        source = fixture()
        source['empfees'][0].update(fee=250, cashFee=249.99999999999997,
                                   cardFee=0, otherFee=2.842170943040401e-14)
        row = normalized(source)['employee_allocations'][0]
        self.assertEqual(row['cash_performance_cents'], 25000)
        self.assertEqual(row['other_performance_cents'], 0)
        self.assertEqual(row['performance_cents'], sum(row[k] for k in
            ('cash_performance_cents', 'card_performance_cents', 'other_performance_cents')))
        self.assertEqual(business.money_cents(-249.99999999999997), -25000)
        for value in (249.9999, 0.001, 0.005, '249.99999999999997', '0.000000000001'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                business.money_cents(value)

    def test_fallback_only_without_primary(self):
        self.assertEqual(set(employee_index([{"empId": 21, "id": 999}])), {"21"})
        self.assertEqual(set(employee_index([{"id": 999}])), {"999"})

    def test_unknown_staff_and_item_do_not_get_guessed(self):
        source = fixture()
        source["empfees"][0].update(empid=999, detailId=999)
        result = normalized(source)
        self.assertIn("unresolved_employee", result["gaps"])
        self.assertIn("unresolved_allocation_item", result["gaps"])

    def test_duplicate_item_or_allocation_is_rejected(self):
        for field in ("details", "empfees"):
            source = fixture()
            source[field].append(copy.deepcopy(source[field][0]))
            with self.subTest(field=field), self.assertRaises(ValueError):
                normalized(source)

    def test_refund_sign_is_retained_for_review(self):
        source = fixture()
        source["paydetail"]["cash"] = -20
        result = normalized(source)
        self.assertIn("signed_adjustment_requires_review", result["gaps"])
        self.assertEqual(next(r["amount_cents"] for r in result["payments"] if r["source_field"] == "cash"), -2000)

    def test_unknown_payment_fields_and_label_conflicts_are_visible(self):
        source = fixture()
        source["paydetail"]["newMethod"] = 50
        self.assertIn("unrecognized_payment_fields", normalized(source)["gaps"])
        source["payConfigs"].append({"field": "cash", "fieldName": "changed"})
        with self.assertRaisesRegex(ValueError, "payment_config_conflict"):
            normalized(source)

    def test_output_and_logs_do_not_include_customer_pii(self):
        result = normalized()
        serialized = json.dumps(result)
        self.assertNotIn("PRIVATE_CUSTOMER", serialized)
        self.assertNotIn("PRIVATE_PHONE", serialized)
        summary = json.dumps(business.inspection_summary(result))
        self.assertNotIn("TEST_STYLIST", summary)
        self.assertNotIn("TEST_TECH", summary)
        self.assertNotIn("amount_cents", summary)

    def test_normalized_digest_stable_under_source_list_order(self):
        source = fixture()
        source["empfees"].reverse()
        source["empList"].reverse()
        self.assertEqual(normalized()["normalized_sha256"], normalized(source)["normalized_sha256"])

    def test_day_keeps_employee_performance_separate_from_project_posting(self):
        result = business.build_day([normalized()], shop="1837032", day="2026-01-01", expected_bill_ids=[42])
        self.assertTrue(result["details_complete"])
        self.assertEqual(result["source_posted_amount_cents"], 10000)
        self.assertEqual(sum(row["observed_performance_cents"] for row in result["employees"]), 20000)
        self.assertFalse(result["report_ready"])

    def test_incomplete_day_never_has_an_apparent_full_total(self):
        result = business.build_day([normalized()], shop="1837032", day="2026-01-01", expected_bill_ids=[42, 43])
        self.assertFalse(result["details_complete"])
        self.assertIsNone(result["source_posted_amount_cents"])
        self.assertEqual(result["missing_bill_ids"], ["43"])

    def test_day_rejects_duplicate_and_cross_store_bill(self):
        for bills in ([normalized(), normalized()], [{**normalized(), "shop_id": "1009951"}]):
            with self.assertRaises(ValueError):
                business.build_day(bills, shop="1837032", day="2026-01-01", expected_bill_ids=[42])

    def test_verified_empty_project_list_is_not_full_business_zero(self):
        result = business.build_day([], shop="1837032", day="2026-01-01", expected_bill_ids=[])
        self.assertEqual(result["source_posted_amount_cents"], 0)
        self.assertIn("full_business_scope_pending", result["gaps"])
        self.assertFalse(result["report_ready"])


if __name__ == "__main__":
    unittest.main()
