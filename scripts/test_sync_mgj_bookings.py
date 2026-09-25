import importlib.util
import base64
import io
import json
import pathlib
import unittest
import urllib.error
from unittest import mock

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


SCRIPT_PATH = pathlib.Path(__file__).with_name("sync_mgj_bookings.py")
SPEC = importlib.util.spec_from_file_location("sync_mgj_bookings", SCRIPT_PATH)
SYNC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SYNC)


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


class SignedRequestTests(unittest.TestCase):
    @mock.patch.object(SYNC.urllib.request, "urlopen")
    def test_request_is_signed_and_reports_pair_result(self, urlopen):
        signing_key = Ed25519PrivateKey.generate()
        result = {"shop_id": "1009951", "date": "2026-09-25", "upserted": 1, "deleted": 2}
        urlopen.return_value.__enter__.return_value.read.return_value = json.dumps(result).encode()
        bookings = [{"id": 7, "shop_id": "1009951", "date": "2026-09-25"}]
        self.assertEqual(SYNC.signed_pair_request("1009951", "2026-09-25", bookings, signing_key), result)
        request = urlopen.call_args.args[0]
        timestamp = request.get_header("X-booking-sync-ts")
        signature = request.get_header("X-booking-sync-signature")
        signing_key.public_key().verify(
            base64.urlsafe_b64decode(signature + "=="),
            timestamp.encode() + b"." + request.data,
        )
        self.assertEqual(json.loads(request.data)["bookings"], bookings)

    @mock.patch.object(SYNC.urllib.request, "urlopen")
    def test_http_error_is_not_reported_as_success(self, urlopen):
        error = urllib.error.HTTPError(SYNC.SYNC_FUNCTION, 401, "Unauthorized", {}, io.BytesIO())
        urlopen.side_effect = error
        with self.assertRaises(urllib.error.HTTPError):
            SYNC.signed_pair_request("1009951", "2026-09-25", [], Ed25519PrivateKey.generate())
        self.assertEqual(urlopen.call_count, 1)
        error.close()

    @mock.patch.object(SYNC.urllib.request, "urlopen")
    def test_mismatched_response_is_rejected(self, urlopen):
        result = {"shop_id": "1837032", "date": "2026-09-25", "upserted": 0, "deleted": 0}
        urlopen.return_value.__enter__.return_value.read.return_value = json.dumps(result).encode()
        with self.assertRaisesRegex(RuntimeError, "返回异常"):
            SYNC.signed_pair_request("1009951", "2026-09-25", [], Ed25519PrivateKey.generate())


class NetworkRetryTests(unittest.TestCase):
    @mock.patch.object(SYNC.time, "sleep")
    def test_transient_error_retries_then_succeeds(self, sleep):
        operation = mock.Mock(side_effect=[TimeoutError("slow"), {"code": 0}])
        self.assertEqual(SYNC.with_network_retries(operation), {"code": 0})
        self.assertEqual(operation.call_count, 2)
        sleep.assert_called_once_with(1)

    @mock.patch.object(SYNC.time, "sleep")
    def test_http_401_is_not_retried(self, sleep):
        error = urllib.error.HTTPError("https://example.invalid", 401, "bad", {}, io.BytesIO())
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
