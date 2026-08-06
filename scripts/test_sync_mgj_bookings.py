import importlib.util
import pathlib
import subprocess
import unittest
import urllib.error
from unittest import mock


SCRIPT_PATH = pathlib.Path(__file__).with_name("sync_mgj_bookings.py")
SPEC = importlib.util.spec_from_file_location("sync_mgj_bookings", SCRIPT_PATH)
SYNC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SYNC)


class BookingDeletionTests(unittest.TestCase):
    def test_deletes_only_from_successful_shop_date_pairs(self):
        existing = [
            {"id": 1, "shop_id": "a", "date": "2026-06-29"},
            {"id": 2, "shop_id": "a", "date": "2026-06-29"},
            {"id": 3, "shop_id": "a", "date": "2026-06-30"},
            {"id": 4, "shop_id": "b", "date": "2026-06-29"},
        ]
        fetched = {
            ("a", "2026-06-29"): [{"id": 1}],
            ("a", "2026-06-30"): [],
        }
        successful = {("a", "2026-06-29")}
        self.assertEqual(
            SYNC.deletion_ids(existing, fetched, successful),
            {2},
        )

    def test_authoritative_empty_pair_deletes_only_that_pair(self):
        existing = [
            {"id": 10, "shop_id": "a", "date": "2026-06-29"},
            {"id": 11, "shop_id": "a", "date": "2026-06-30"},
        ]
        successful = {("a", "2026-06-29")}
        self.assertEqual(
            SYNC.deletion_ids(existing, {}, successful),
            {10},
        )


class BookingNormalizationTests(unittest.TestCase):
    def test_normalization_keeps_fields_needed_by_app(self):
        shop = {"shopId": "100", "name": "测试店"}
        raw = {
            "id": "88",
            "status": 3,
            "custName": "顾客",
            "memmobile": "13800000000",
            "barberName": "发型师",
            "barberId": 99,
            "categoryName": "烫发",
            "comment": "备注",
            "reservationTime": 1782700200000,
        }
        result = SYNC.normalize_reservation(
            raw,
            shop,
            "2026-06-29",
            "2026-06-29",
        )
        self.assertEqual(result["id"], 88)
        self.assertEqual(result["customer_phone"], "13800000000")
        self.assertEqual(result["barber_name"], "发型师")
        self.assertEqual(result["barber_id"], "99")
        self.assertEqual(result["service_name"], "烫发")
        self.assertEqual(result["status"], 3)


class SupabaseRequestTests(unittest.TestCase):
    @mock.patch.object(SYNC.subprocess, "run")
    def test_http_error_is_not_reported_as_success(self, run):
        run.return_value = subprocess.CompletedProcess(
            args=["curl"],
            returncode=22,
            stdout='{"message":"quota exceeded"}',
            stderr="curl: (22) HTTP 402",
        )
        with self.assertRaisesRegex(RuntimeError, "HTTP 402"):
            SYNC.curl_request("GET", "bookings?select=id")

    @mock.patch.object(SYNC.subprocess, "run")
    def test_curl_uses_bounded_transient_retries(self, run):
        run.return_value = subprocess.CompletedProcess(
            args=["curl"], returncode=0, stdout="[]", stderr=""
        )
        SYNC.curl_request("GET", "bookings?select=id")
        command = run.call_args.args[0]
        self.assertEqual(command[command.index("--retry") + 1], "2")
        self.assertIn("--retry-connrefused", command)


class NetworkRetryTests(unittest.TestCase):
    @mock.patch.object(SYNC.time, "sleep")
    def test_transient_error_retries_then_succeeds(self, sleep):
        operation = mock.Mock(side_effect=[TimeoutError("slow"), {"code": 0}])
        self.assertEqual(SYNC.with_network_retries(operation), {"code": 0})
        self.assertEqual(operation.call_count, 2)
        sleep.assert_called_once_with(1)

    @mock.patch.object(SYNC.time, "sleep")
    def test_http_401_is_not_retried(self, sleep):
        error = urllib.error.HTTPError("https://example.invalid", 401, "bad", {}, None)
        operation = mock.Mock(side_effect=error)
        try:
            with self.assertRaises(urllib.error.HTTPError):
                SYNC.with_network_retries(operation)
            self.assertEqual(operation.call_count, 1)
            sleep.assert_not_called()
        finally:
            error.close()


if __name__ == "__main__":
    unittest.main()
