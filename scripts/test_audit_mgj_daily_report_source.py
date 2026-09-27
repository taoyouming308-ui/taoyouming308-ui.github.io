import json
import subprocess
import unittest
from datetime import date
from unittest.mock import patch
import urllib.parse

from scripts import audit_mgj_daily_report_source as audit


class AuditSourceTests(unittest.TestCase):
    @staticmethod
    def summary_content(row=None, **overrides):
        columns = [None] * 24
        for index in (0, 14, 22, 23):
            columns[index] = {"width": "100", "sortable": "2"}
        content = {
            "head": audit.DAILY_SUMMARY_HEADERS[:],
            "headTop": [
                {"rowspan": "2", "text": "日期"},
                {"colspan": "10", "text": "现金类"},
                {"colspan": 4, "text": "划卡类"},
                {"colspan": 9, "text": "其他非现类"},
            ],
            "data": [row if row is not None else ["2026-09-28"] + [""] * 23],
            "columns": columns,
            "config": {"title": "门店营业日汇总"},
        }
        content.update(overrides)
        return content

    @staticmethod
    def fully_known_summary_row():
        row = ["2026-09-28"] + ["0"] * 23
        row[1] = "45"
        for index, value in zip(range(2, 11), range(1, 10)):
            row[index] = str(value)
        row[11] = "60"
        for index, value in zip(range(12, 15), (10, 20, 30)):
            row[index] = str(value)
        row[15] = "36"
        for index, value in zip(range(16, 24), range(1, 9)):
            row[index] = str(value)
        return row

    def test_sanitizer_keeps_allowlisted_fields_only(self):
        content = {
            "id": "9001", "shopid": "1009951", "consumetime": 1790500000000,
            "type": 2, "status": 1, "eafee": "120.00", "money": "100",
            "customerName": "SENSITIVE_CUSTOMER", "phone": "13812345678",
            "payConfigs": [{"field": "cash", "fieldName": "现金", "type": "number", "accountName": "LEAK"}],
            "paydetail": {"cash": 80, "cardfee": 20, "memberid": 17, "name": "LEAK"},
            "details": [{"id": 7, "type": 1, "depcode": "D1", "depcodename": "染膏", "itemno": "I1",
                         "itemname": "染发", "num": 1, "price": 120, "money": 120, "customerName": "LEAK"}],
            "empList": [
                {"id": "E1", "empId": "E1-ALT", "dutyname": "C级技师", "empname": "SENSITIVE_EMPLOYEE"},
                {"id": "E2", "empId": "E2-ALT", "dutyname": "设计师", "empname": "SENSITIVE_EMPLOYEE_2"},
            ],
            "empfees": [
                {"empid": "E1-ALT", "detailId": 8, "fee": 980, "gain": 5, "cardFee": 10,
                 "cashFee": 20, "otherFee": 0, "projectCount": 1, "personCount": 1,
                 "empname": "SENSITIVE_EMPLOYEE", "employeeId": "E1"},
                {"empid": "E2-ALT", "detailId": 9, "fee": 980, "gain": 5, "empname": "SENSITIVE_EMPLOYEE_2"},
            ],
            "cashDetails": [{"cash": 20, "phone": "13812345678", "customer": "LEAK"}],
        }
        result = audit.sanitize_detail(content)
        serialized = json.dumps(result, ensure_ascii=False)
        self.assertNotIn("SENSITIVE_CUSTOMER", serialized)
        self.assertNotIn("13812345678", serialized)
        self.assertNotIn("SENSITIVE_EMPLOYEE", serialized)
        self.assertNotIn("SENSITIVE_EMPLOYEE_2", serialized)
        self.assertNotIn("LEAK", serialized)
        self.assertNotIn("employeeId", serialized)
        self.assertNotIn("memberid", serialized)
        self.assertNotIn('"E1"', serialized)
        self.assertEqual([row["dutyname"] for row in result["empfees"]], ["C级技师", "设计师"])
        self.assertEqual(result["empfees"][0]["gain"], 5)
        self.assertEqual(result["payConfigs"], [{"field": "cash", "fieldName": "现金", "type": "number"}])
        self.assertEqual(result["paydetail"], {"cash": 80, "cardfee": 20})
        self.assertEqual(result["eafee"], 120)
        self.assertEqual(result["money"], 100)
        self.assertEqual(result["cash_card_summaries"]["cashdetails"],
                         {"count": 1, "numeric_sums": {"cash": 20}})

    def test_conflicting_employee_alias_is_rejected(self):
        content = {
            "empList": [
                {"id": "A", "empId": "SHARED", "dutyname": "设计师"},
                {"id": "B", "empId": "SHARED", "dutyname": "技师"},
            ],
            "empfees": [],
        }
        with self.assertRaisesRegex(audit.AuditError, "employee_id_alias_conflict"):
            audit.sanitize_detail(content)

    def test_date_shop_and_limit_validation(self):
        today = date(2026, 9, 28)
        self.assertEqual(audit.validate_day("2026-09-28", today), "2026-09-28")
        for invalid in ("2026-02-30", "2025-12-31", "2026-09-29", "2026-9-8"):
            with self.subTest(invalid=invalid), self.assertRaises(audit.AuditError):
                audit.validate_day(invalid, today)
        for invalid in ("0", "4", "1.5", "03"):
            with self.subTest(limit=invalid), self.assertRaises(audit.AuditError):
                audit.validate_bill_limit(invalid)
        self.assertEqual(audit.validate_bill_limit("3"), 3)
        with self.assertRaises(audit.AuditError):
            audit.validate_shop("999999")

    def test_shop_and_date_mismatch_rejected(self):
        content = {"id": "42", "shopid": "1009951", "consumetime": "2026-09-28T12:00:00+08:00"}
        with self.assertRaisesRegex(audit.AuditError, "bill_id_mismatch"):
            audit.verify_bill_scope(content, "43", "1009951", "2026-09-28")
        with self.assertRaisesRegex(audit.AuditError, "bill_shop_mismatch"):
            audit.verify_bill_scope(content, "42", "1837032", "2026-09-28")
        with self.assertRaisesRegex(audit.AuditError, "bill_date_mismatch"):
            audit.verify_bill_scope(content, "42", "1009951", "2026-09-27")

    def test_curl_keeps_cookie_and_body_out_of_argv_and_verifies_tls(self):
        seen = {}

        def fake_runner(command, **kwargs):
            seen["command"] = command
            seen["input"] = kwargs["input"]
            return subprocess.CompletedProcess(command, 0, stdout='{"code":0}\n200', stderr="")

        cookie = "sid=TOP_SECRET"
        body = "PRIVATE_PAYLOAD"
        result = audit.curl_request("https://example.invalid/read-only", [("Cookie", cookie)], body,
                                    runner=fake_runner)
        self.assertEqual(result, '{"code":0}')
        self.assertNotIn(cookie, " ".join(seen["command"]))
        self.assertNotIn(body, " ".join(seen["command"]))
        self.assertIn(cookie, seen["input"])
        self.assertIn(body, seen["input"])
        self.assertNotIn("-k", seen["command"])
        self.assertNotIn("--insecure", seen["command"])
        self.assertEqual(seen["command"][1], "--disable")
        self.assertIn("--config", seen["command"])
        self.assertIn("-", seen["command"])

    def test_multipart_contract_and_session_shop_fallback(self):
        self.assertEqual(audit.session_shop_id({"shop_id": "17", "shop": {"id": "18"}}), "17")
        self.assertEqual(audit.session_shop_id({"shop": {"id": "18"}}), "18")
        self.assertEqual(audit.session_shop_id({}), "1103470")
        body = audit.multipart_body({"parentShopId": 1103470, "id": 42, "fromHis": 0}, "18")
        self.assertIn('name="jsonObj"', body)
        self.assertIn('{"parentShopId":1103470,"id":42,"fromHis":0}', body)
        self.assertIn('name="shopid"', body)
        quoted = audit.config_quote("line1\r\nline2")
        self.assertIn("\\r", quoted)
        self.assertIn("\\n", quoted)

    def test_menu_only_returns_filtered_attrs_and_unexecuted_paths(self):
        parser = audit.MenuParser()
        parser.feed('<a href="/shair/report!daily.action?token=secret" class="统计">统计报表</a>'
                    '<a href="/shair/unrelated.action">帮助</a>')
        result = {"menu_links": parser.links, "report_action_urls_not_executed": sorted(parser.action_urls)}
        serialized = json.dumps(result, ensure_ascii=False)
        self.assertIn("统计", serialized)
        self.assertNotIn("secret", serialized)
        self.assertEqual(result["report_action_urls_not_executed"], ["/shair/report!daily.action"])
        self.assertEqual(len(result["menu_links"]), 1)

    def test_budget_cannot_exceed_one_minute(self):
        with patch.object(audit, "acquire_shared_lock"), patch.object(audit, "load_config", return_value={}):
            with self.assertRaisesRegex(audit.AuditError, "invalid_budget"):
                audit.audit("1009951", "2026-09-28", budget_seconds=61)

    def test_daily_summary_payload_and_response_request_contract(self):
        captured = {}
        content = self.summary_content()
        response_text = json.dumps({"code": 0, "content": content}, ensure_ascii=False) + "\n200"

        def fake_runner(command, **kwargs):
            captured["command"] = command
            captured["input"] = kwargs["input"]
            return subprocess.CompletedProcess(command, 0, stdout=response_text, stderr="")

        config = {"cookies": "sid=PRIVATE", "shop_id": "1103470"}
        result = audit.request_daily_summary("1009951", "2026-09-28", config, "all", runner=fake_runner)
        self.assertEqual(result, content)
        self.assertEqual(captured["command"][-1], audit.DAILY_SUMMARY_URL)
        self.assertNotIn("sid=PRIVATE", " ".join(captured["command"]))
        self.assertIn("sid=PRIVATE", captured["input"])
        payload = {
            "parentShopId": 1103470,
            "shopId": "1103470",
            "shopIds": ["1009951"],
            "period": "1790553600000_1790553600000",
            "incomeType": ["1", "2", "3", "4", "5"],
            "depcode": "-1",
        }
        form = urllib.parse.urlencode({"jsonObj": json.dumps(payload, separators=(",", ":")), "shopid": "1103470"})
        self.assertIn(audit.config_quote(form), captured["input"])
        projects = audit.daily_summary_payload("1837032", "2026-09-28", config, "projects")
        self.assertEqual(projects["incomeType"], ["1"])
        self.assertEqual(projects["shopIds"], ["1837032"])

    def test_daily_summary_converts_cents_and_checks_groups(self):
        result = audit.parse_daily_summary(
            self.summary_content(self.fully_known_summary_row()), "1009951", "2026-09-28", "projects"
        )
        self.assertEqual(result["source_scope"]["verification"], "request_only")
        self.assertEqual(result["cents"]["总额#1"], 4500)
        self.assertEqual([group["delta_cents"] for group in result["group_checks"]], [0, 0, 0])
        self.assertTrue(all(not group["has_unknown"] for group in result["group_checks"]))
        self.assertEqual(result["header"], audit.DAILY_SUMMARY_HEADERS)

    def test_daily_summary_blank_is_unknown_and_never_zero(self):
        row = ["2026-09-28", "2126.0", "", "", "1850.0", "50.0", "226.0"] + [""] * 17
        result = audit.parse_daily_summary(self.summary_content(row), "1009951", "2026-09-28")
        self.assertIsNone(result["cents"]["现金#2"])
        self.assertEqual(result["cents"]["支付宝#4"], 185000)
        self.assertTrue(result["group_checks"][0]["has_unknown"])
        self.assertEqual(result["group_checks"][0]["known_sum_cents"], 212600)
        self.assertIsNone(result["group_checks"][0]["delta_cents"])
        self.assertTrue(any("request_only" in note for note in result["scope_limitations"]))

    def test_daily_summary_rejects_negative_fractional_duplicate_wrong_empty_and_changed_shapes(self):
        base = self.fully_known_summary_row()
        for index, bad_value in ((2, "-1"), (3, "1.001"), (4, "not-money"), (2, "9" * 30)):
            row = base[:]
            row[index] = bad_value
            with self.subTest(value=bad_value), self.assertRaises(audit.AuditError):
                audit.parse_daily_summary(self.summary_content(row), "1009951", "2026-09-28")
        with self.assertRaisesRegex(audit.AuditError, "summary_duplicate_or_multiple_rows"):
            audit.parse_daily_summary(self.summary_content(data=[base, base]), "1009951", "2026-09-28")
        with self.assertRaisesRegex(audit.AuditError, "summary_date_mismatch"):
            audit.parse_daily_summary(self.summary_content(base[:0] + ["2026-09-27"] + base[1:]),
                                      "1009951", "2026-09-28")
        with self.assertRaisesRegex(audit.AuditError, "summary_no_rows"):
            audit.parse_daily_summary(self.summary_content(data=[]), "1009951", "2026-09-28")
        with self.assertRaisesRegex(audit.AuditError, "summary_header_changed"):
            audit.parse_daily_summary(self.summary_content(head=["unknown"] * 24), "1009951", "2026-09-28")
        with self.assertRaisesRegex(audit.AuditError, "summary_columns_changed"):
            audit.parse_daily_summary(self.summary_content(columns=[None] * 23), "1009951", "2026-09-28")
        with self.assertRaisesRegex(audit.AuditError, "summary_headtop_changed"):
            audit.parse_daily_summary(self.summary_content(headTop=[]), "1009951", "2026-09-28")

    def test_daily_summary_is_single_locked_read_only_mode(self):
        class FakeLock:
            closed = False

            def close(self):
                self.closed = True

        lock = FakeLock()
        content = self.summary_content(self.fully_known_summary_row())
        with patch.object(audit, "acquire_shared_lock", return_value=lock), \
             patch.object(audit, "load_config", return_value={}), \
             patch.object(audit, "request_daily_summary", return_value=content) as request, \
             patch.object(audit.daily, "fetch_period") as project_list:
            result = audit.audit("1009951", "2026-09-28", daily_summary=True, summary_scope="all")
        request.assert_called_once()
        project_list.assert_not_called()
        self.assertTrue(lock.closed)
        self.assertEqual(result["mode"], "daily_summary")


if __name__ == "__main__":
    unittest.main()
