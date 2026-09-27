import base64
import io
import json
import os
import stat
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
import urllib.error

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

from scripts import audit_mgj_daily_report_source as audit
from scripts import sync_mgj_daily_electronic_sources as sync


DAY = "2026-09-28"
SHOP = "1009951"
FETCHED_AT = "2026-01-01T00:00:00Z"


def valid_content():
    columns = [None] * 24
    for index in (0, 14, 22, 23):
        columns[index] = {"width": "100", "sortable": "2"}
    row = [DAY] + [""] * 23
    row[1] = "2126.0"
    row[4] = "1850.0"
    row[5] = "50.0"
    row[6] = "226.0"
    return {
        "head": audit.DAILY_SUMMARY_HEADERS[:],
        "headTop": [
            {"rowspan": "2", "text": "日期"},
            {"colspan": "10", "text": "现金类"},
            {"colspan": 4, "text": "划卡类"},
            {"colspan": 9, "text": "其他非现类"},
        ],
        "data": [row],
        "columns": columns,
        "config": {"title": "门店营业日汇总"},
    }


def candidate(scope="projects"):
    source = sync.source_object(SHOP, DAY, scope, {"shop_id": "1103470"}, valid_content())
    return sync.make_candidate(SHOP, DAY, scope, source, FETCHED_AT)


def valid_receipt(payload):
    return {
        "snapshot_id": "00000000-0000-4000-8000-000000000001",
        "candidate_id": "00000000-0000-4000-8000-000000000002",
        "source_sha256": "a" * 64,
        "version": 1,
        "status": "needs_review",
        "stage": "source_only",
        "inserted": True,
        "latest": True,
        "watermark_advanced": True,
        "fetched_at": payload["fetched_at"].replace("Z", "+00:00"),
        "latest_fetched_at": payload["fetched_at"],
        "source_scope": payload["source_scope"],
        "scope_verified": False,
        "formal_ledger_amount_changed": False,
    }


class SignedResponse:
    def __init__(self, value):
        self.value = value

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, *_args):
        return json.dumps(self.value).encode()


class SyncElectronicSourcesTests(unittest.TestCase):
    def test_candidate_contract_and_source_requires_validated_content(self):
        config = {"shop_id": "1103470"}
        source = sync.source_object(SHOP, DAY, "projects", config, valid_content())
        self.assertEqual(set(source), {"shop_id", "business_date", "query", "content"})
        self.assertEqual(source["query"]["shopIds"], [SHOP])
        self.assertEqual(source["query"]["incomeType"], ["1"])
        self.assertEqual(sync.make_candidate(SHOP, DAY, "projects", source, FETCHED_AT), {
            "operation": "source_append", "shop": "自由手艺人", "date": DAY,
            "source_scope": "projects_daily_summary", "fetched_at": FETCHED_AT, "source": source,
        })
        empty = valid_content()
        empty["data"] = []
        with self.assertRaisesRegex(audit.AuditError, "summary_no_rows"):
            sync.source_object(SHOP, DAY, "projects", config, empty)

    def test_signature_uses_new_domain_and_compact_utf8_body(self):
        key = Ed25519PrivateKey.generate()
        payload = {"operation": "source_append", "shop": "自由手艺人", "date": DAY}
        body, signature = sync.signature_for(payload, key, "1789999999")
        key.public_key().verify(
            base64.urlsafe_b64decode(signature + "=="),
            b"mgj-daily-report-sync\n1789999999." + body,
        )
        self.assertEqual(body, json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode())

    def test_write_sends_exact_headers_tls_context_and_validates_receipt(self):
        key = Ed25519PrivateKey.generate()
        payload = candidate()
        payload["fetched_at"] = FETCHED_AT
        receipt = valid_receipt(payload)
        observed = {}

        def fake_urlopen(request, timeout, context):
            observed["request"] = request
            observed["timeout"] = timeout
            observed["context"] = context
            return SignedResponse(receipt)

        result = sync.submit_candidate(payload, key, 9, urlopen=fake_urlopen, now=1789999999)
        self.assertEqual(result["status"], "accepted")
        req = observed["request"]
        self.assertEqual(req.full_url, sync.SYNC_ENDPOINT)
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(req.get_header("X-daily-report-sync-ts"), "1789999999")
        self.assertTrue(req.get_header("X-daily-report-sync-signature"))
        self.assertEqual(req.get_header("Apikey"), sync.private_sync.PUBLIC_API_KEY)
        self.assertEqual(observed["timeout"], 9)
        self.assertTrue(observed["context"].check_hostname)
        self.assertEqual(observed["context"].verify_mode, sync.ssl.CERT_REQUIRED)
        signed = b"mgj-daily-report-sync\n1789999999." + req.data
        key.public_key().verify(
            base64.urlsafe_b64decode(req.get_header("X-daily-report-sync-signature") + "=="), signed
        )

    def test_write_timeout_is_unconfirmed_and_never_retried(self):
        key = Ed25519PrivateKey.generate()
        calls = []

        def timeout_once(*_args, **_kwargs):
            calls.append(1)
            raise TimeoutError("private details must not be surfaced")

        result = sync.submit_candidate(candidate(), key, 10, urlopen=timeout_once, now=1789999999)
        self.assertEqual(result, {"status": "unconfirmed", "reason": "transport_uncertain"})
        self.assertEqual(len(calls), 1)

    def test_signed_payloads_are_not_forwarded_on_redirects(self):
        handler = sync.NoRedirectHandler()
        self.assertIsNone(handler.redirect_request(None, None, 302, "Found", {}, "https://other.invalid/"))

    def test_invalid_receipt_is_unconfirmed_and_receipt_validation_is_strict(self):
        key = Ed25519PrivateKey.generate()
        result = sync.submit_candidate(candidate(), key, 10,
                                       urlopen=lambda *_args, **_kwargs: SignedResponse({"ok": True}),
                                       now=1789999999)
        self.assertEqual(result, {"status": "unconfirmed", "reason": "invalid_receipt"})
        payload = candidate()
        receipt = valid_receipt(payload)
        self.assertEqual(sync.validate_receipt(receipt, payload)["status"], "needs_review")
        receipt["formal_ledger_amount_changed"] = True
        with self.assertRaisesRegex(sync.SyncError, "invalid_receipt"):
            sync.validate_receipt(receipt, payload)
        receipt = valid_receipt(payload)
        receipt["fetched_at"] = "2025-12-31T23:59:00Z"
        with self.assertRaisesRegex(sync.SyncError, "invalid_receipt"):
            sync.validate_receipt(receipt, payload)

    def test_receipt_accepts_preserved_snapshot_time_and_checks_watermark(self):
        payload = candidate()
        payload["fetched_at"] = "2026-09-27T10:00:00Z"
        receipt = valid_receipt(payload)
        receipt["inserted"] = False
        receipt["fetched_at"] = "2026-09-26T10:00:00+00:00"
        receipt["latest_fetched_at"] = "2026-09-27T11:00:00Z"
        self.assertEqual(sync.validate_receipt(receipt, payload)["fetched_at"], receipt["fetched_at"])

        receipt["latest"] = False
        self.assertEqual(sync.validate_receipt(receipt, payload)["latest"], False)
        receipt["latest_fetched_at"] = "2026-09-27T09:00:00Z"
        with self.assertRaisesRegex(sync.SyncError, "invalid_receipt"):
            sync.validate_receipt(receipt, payload)

    def test_http_409_unconfirmed_outcome_is_not_retried_or_echoed(self):
        key = Ed25519PrivateKey.generate()
        calls = []

        def conflict_once(*_args, **_kwargs):
            calls.append(1)
            raise urllib.error.HTTPError(sync.SYNC_ENDPOINT, 409, "Conflict", {},
                                         io.BytesIO(b'{"outcome":"unconfirmed","private":"DO_NOT_PRINT"}'))

        result = sync.submit_candidate(candidate(), key, 10, urlopen=conflict_once, now=1789999999)
        self.assertEqual(result, {"status": "unconfirmed", "http_status": 409, "reason": "server_unconfirmed"})
        self.assertNotIn("DO_NOT_PRINT", json.dumps(result))
        self.assertEqual(len(calls), 1)

    def test_signing_key_must_be_private_0600(self):
        key = Ed25519PrivateKey.generate()
        pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption())
        with tempfile.NamedTemporaryFile() as file:
            file.write(pem)
            file.flush()
            os.chmod(file.name, stat.S_IRUSR | stat.S_IWUSR)
            with patch.object(sync.private_sync, "KEY_PATH", file.name):
                loaded = sync.load_signing_key()
                self.assertIsInstance(loaded, Ed25519PrivateKey)
                os.chmod(file.name, stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP)
                with self.assertRaisesRegex(sync.SyncError, "signing_key_permissions_invalid"):
                    sync.load_signing_key()

    def fresh_state(self):
        now = time_now = datetime.now(sync.TZ).timestamp()
        today = datetime.now(sync.TZ).date().isoformat()
        return {"pairs": {shop_id + ":" + today: {"success_at": now} for shop_id in sync.SHOPS}}

    def test_dry_run_is_default_minimal_and_does_not_load_signing_key(self):
        class Lock:
            closed = False
            def close(self):
                self.closed = True

        lock = Lock()
        reads = []

        def read_summary(shop, day, config, scope, deadline=None):
            reads.append((shop, day, scope))
            return valid_content()

        with patch.object(sync, "fresh_fetched_at", return_value=FETCHED_AT):
            result = sync.run(SHOP, DAY, config_loader=lambda: {"shop_id": "1103470", "cookies": "SECRET"},
                              summary_reader=read_summary, key_loader=lambda: self.fail("dry-run loaded key"),
                              state_reader=self.fresh_state, lock_acquirer=lambda: lock)
        self.assertEqual(result["status"], "dry_run_ready")
        self.assertEqual([scope for _, _, scope in reads], ["projects", "all"])
        self.assertEqual([entry["status"] for entry in result["scopes"]], ["dry_run_ready", "dry_run_ready"])
        self.assertTrue(all(len(entry["local_source_digest"]) == 64 for entry in result["scopes"]))
        self.assertNotIn("source_sha256", json.dumps(result))
        self.assertNotIn("2126.0", json.dumps(result))
        self.assertNotIn("SECRET", json.dumps(result))
        self.assertTrue(lock.closed)

    def test_write_partial_preserves_first_receipt_when_second_scope_missing(self):
        key = Ed25519PrivateKey.generate()
        submitted = []

        def read_summary(_shop, _day, _config, scope, deadline=None):
            if scope == "all":
                raise audit.AuditError("summary_no_rows")
            return valid_content()

        def submit(payload, signing_key, timeout):
            submitted.append(payload["source_scope"])
            return {"status": "accepted", "receipt": {"candidate_id": "00000000-0000-4000-8000-000000000002", "source_sha256": "a" * 64}}

        with patch.object(sync, "fresh_fetched_at", return_value=FETCHED_AT):
            result = sync.run(SHOP, DAY, write=True, config_loader=lambda: {"shop_id": "1103470"},
                              summary_reader=read_summary, key_loader=lambda: key, submitter=submit,
                              state_reader=self.fresh_state, lock_acquirer=lambda: type("Lock", (), {"close": lambda self: None})())
        self.assertEqual(result["status"], "partial")
        self.assertEqual(submitted, ["projects_daily_summary"])
        self.assertEqual([entry["status"] for entry in result["scopes"]], ["accepted", "missing_source"])

    def test_lock_and_daily_sync_due_yield_without_fetching(self):
        busy = sync.run(SHOP, DAY, state_reader=self.fresh_state, lock_acquirer=lambda: None)
        self.assertEqual(busy["status"], "yielded_lock_busy")
        with patch.object(sync, "daily_sync_due", return_value=True):
            due = sync.run(SHOP, DAY, summary_reader=lambda *_args, **_kwargs: self.fail("must yield"),
                           state_reader=lambda: {})
        self.assertEqual(due["status"], "yielded_daily_sync_due")


if __name__ == "__main__":
    unittest.main()
