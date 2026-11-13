import copy
import io
import json
import os
import unittest
from unittest import mock
import zysyr_voucher_codex_bridge as voucher
import zysyr_daily_codex_bridge as bridge


class VoucherTests(unittest.TestCase):
    def sample(self):
        return dict(document_kind="receipt", document_date="2026-07-01", amount=236.8,
                    counterparty="测试商店", document_number=None,
                    evidence=dict(document_date="2026-07-01", amount="实付236.80", counterparty="测试商店", document_number=""),
                    confidence=dict(document_date=.99, amount=.99, counterparty=.95, document_number=0), warnings=[])

    def test_explicit_fields_only(self):
        result = voucher.normalize(self.sample(), "2026-07")
        self.assertEqual(result["fields"]["amount"], 236.8)
        self.assertTrue(result["candidate_only"])
        self.assertTrue(result["human_review_required"])

    def test_missing_evidence_low_confidence_and_invalid_values_stay_unknown(self):
        for key, value in [("document_date", "2026-02-30"), ("amount", True), ("amount", float("nan")), ("amount", .001), ("amount", -2)]:
            raw = self.sample(); raw[key] = value
            self.assertIsNone(voucher.normalize(raw, "2026-07")["fields"][key])
        for key in voucher.FIELDS:
            raw = self.sample(); raw["evidence"][key] = ""
            self.assertIsNone(voucher.normalize(raw, "2026-07")["fields"][key])
            raw = self.sample(); raw["confidence"][key] = .2
            self.assertIsNone(voucher.normalize(raw, "2026-07")["fields"][key])

    def test_multiple_transactions_and_bank_summary_never_single_amount(self):
        for kind in ("bank_summary", "multiple_transactions", "unknown"):
            raw = self.sample(); raw["document_kind"] = kind
            result = voucher.normalize(raw, "2026-07")
            self.assertIsNone(result["fields"]["amount"])
            self.assertIsNone(result["fields"]["document_date"])

    def test_month_mismatch_not_rewritten(self):
        raw = self.sample(); raw["document_date"] = "2026-09-11"
        result = voucher.normalize(raw, "2026-07")
        self.assertEqual(result["fields"]["document_date"], "2026-09-11")
        self.assertTrue(any("不属于" in w for w in result["warnings"]))

    def test_voucher_dispatch_uses_existing_auth_and_allowlisted_download(self):
        class Handler:
            def __init__(self, token):
                body = json.dumps(dict(task_type="expense_voucher", image_url="https://test.invalid/x", month="2026-07")).encode()
                self.rfile = io.BytesIO(body)
                self.headers = {"Authorization": token, "Content-Length": str(len(body))}
            def send_json(self, data, status=200): self.sent = (data, status)
        with mock.patch.dict(os.environ, {"ZYSYR_DAILY_CODEX_TOKEN": "test-only"}):
            denied = Handler("Bearer wrong")
            bridge.handle_daily_codex_recognition(denied)
            self.assertEqual(denied.sent[1], 401)
            allowed = Handler("Bearer test-only")
            with mock.patch.object(bridge, "_download_image", return_value=".png") as download, mock.patch.object(bridge, "recognize_voucher", return_value={"candidate_only": True}) as recognize:
                bridge.handle_daily_codex_recognition(allowed)
                self.assertEqual(allowed.sent[1], 200)
                download.assert_called_once(); recognize.assert_called_once()
                self.assertEqual(recognize.call_args.args[1], "2026-07")
            with self.assertRaises(ValueError):
                bridge._download_image("https://test.invalid/x", None)


if __name__ == "__main__": unittest.main()
