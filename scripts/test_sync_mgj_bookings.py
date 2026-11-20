import importlib.util
import base64
import io
import json
import pathlib
import tempfile
import unittest
import urllib.error
from unittest import mock

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


SCRIPT_PATH = pathlib.Path(__file__).with_name("sync_mgj_bookings.py")
SPEC = importlib.util.spec_from_file_location("sync_mgj_bookings", SCRIPT_PATH)
SYNC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SYNC)


def setUpModule():
    global TURN_DIRECTORY, TURN_PATCH
    TURN_DIRECTORY = tempfile.TemporaryDirectory()
    TURN_PATCH = mock.patch.object(SYNC.source_turns, 'ROOT', pathlib.Path(TURN_DIRECTORY.name) / 'turns')
    TURN_PATCH.start()


def tearDownModule():
    TURN_PATCH.stop()
    TURN_DIRECTORY.cleanup()


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
        result = {"shop_id": "1009951", "date": "2026-09-25", "upserted": 1, "deleted": 2, "protocol": 2, "operation": "commit", "lease_id": "test"}
        urlopen.return_value.__enter__.return_value.read.return_value = json.dumps(result).encode()
        bookings = [{"id": 7, "shop_id": "1009951", "date": "2026-09-25"}]
        self.assertEqual(SYNC.signed_protocol_request({"protocol": 2, "operation": "commit", "shop_id": "1009951", "date": "2026-09-25", "lease_id": "test", "bookings": bookings}, signing_key), result)
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
            SYNC.signed_protocol_request({"protocol": 2, "operation": "commit", "shop_id": "1009951", "date": "2026-09-25", "lease_id": "test", "bookings": []}, Ed25519PrivateKey.generate())
        self.assertEqual(urlopen.call_count, 1)
        error.close()

    @mock.patch.object(SYNC.urllib.request, "urlopen")
    def test_mismatched_response_is_rejected(self, urlopen):
        result = {"shop_id": "1837032", "date": "2026-09-25", "upserted": 0, "deleted": 0}
        urlopen.return_value.__enter__.return_value.read.return_value = json.dumps(result).encode()
        with self.assertRaisesRegex(RuntimeError, "返回异常"):
            SYNC.signed_protocol_request({"protocol": 2, "operation": "commit", "shop_id": "1009951", "date": "2026-09-25", "lease_id": "test", "bookings": []}, Ed25519PrivateKey.generate())


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


class CadenceTests(unittest.TestCase):
    @mock.patch.object(SYNC, "reservation_date_keys", return_value=["d0", "d1", "d2", "d3"])
    def test_today_first_and_only_one_due_future_day(self, dates):
        self.assertEqual(SYNC.scheduled_dates({}, 2000), ["d0", "d1"])
        state = {"dates": {"d1": {"success_at": 1999}, "d2": {"retry_after": 2001}}}
        self.assertEqual(SYNC.scheduled_dates(state, 2000), ["d0", "d3"])
        state = {"dates": {d: {"success_at": 1999} for d in ["d1", "d2", "d3"]}}
        self.assertEqual(SYNC.scheduled_dates(state, 2000), ["d0"])
        self.assertEqual(SYNC.scheduled_dates(state, 2900), ["d0", "d1"])

    @mock.patch.object(SYNC, "request_json", side_effect=TimeoutError("offline"))
    def test_session_network_failure_does_not_trigger_login(self, request):
        with mock.patch.object(SYNC, "load_json", return_value={"cookies": "session"}), mock.patch.object(SYNC, "login") as login:
            with self.assertRaises(TimeoutError):
                SYNC.ensure_session()
            login.assert_not_called()

    def test_scheduled_failure_only_advances_successful_date(self):
        shops = SYNC.SHOPS
        state = {"dates": {}}
        with mock.patch.object(SYNC, "ensure_session", return_value=("host", "cookie")), \
             mock.patch.object(SYNC, "load_signing_key", return_value=object()), \
             mock.patch.object(SYNC, "fetch_reservation_snapshot", side_effect=[{"raw_rows":[],"bookings":[]}, {"raw_rows":[],"bookings":[]}, TimeoutError("offline")]), \
             mock.patch.object(SYNC, "signed_protocol_request", return_value={"upserted": 0, "deleted": 0, "lease_id":"test", "generation":1}) as write, \
             mock.patch.object(SYNC, "atomic_write_json"), mock.patch.object(SYNC, "write_status"), \
             mock.patch.object(SYNC, "reservation_date_keys", return_value=["today", "future"]):
            self.assertEqual(SYNC.sync_bookings(["today", "future"], state), 1)
            self.assertIn("success_at", state["dates"]["today"])
            self.assertNotIn("success_at", state["dates"]["future"])
            self.assertNotIn((shops[0]["shopId"], "future"), [(c.args[0]["shop_id"], c.args[0]["date"]) for c in write.call_args_list if c.args[0]["operation"] == "commit"])


if __name__ == "__main__":
    unittest.main()


class BookingSourceTransportTests(unittest.TestCase):
    def test_exact_read_source_uses_direct_verified_tls_and_no_redirects(self):
        for path in ("/shair/metedata!reservationMetadata.action", "/shair/reservation!list.action"):
            req = SYNC.urllib.request.Request("https://vip12.meiguanjia.net" + path)
            with mock.patch.object(SYNC.urllib.request, "build_opener") as build:
                SYNC.source_urlopen(req, 9)
                handlers = build.call_args.args
                self.assertEqual(handlers[0].proxies, {})
                self.assertIsInstance(handlers[1], SYNC.NoSourceRedirect)
                self.assertTrue(handlers[2]._context.check_hostname)
                self.assertEqual(handlers[2]._context.verify_mode, SYNC.ssl.CERT_REQUIRED)
                build.return_value.open.assert_called_once_with(req, timeout=9)

    def test_rejects_non_source_and_write_destinations_before_network(self):
        urls = ["http://vip12.meiguanjia.net/shair/reservation!list.action",
                "https://evil.invalid/shair/reservation!list.action",
                "https://vip12.meiguanjia.net/shair/reservation!save.action",
                "https://vip12.meiguanjia.net:444/shair/reservation!list.action",
                "https://user@vip12.meiguanjia.net/shair/reservation!list.action",
                "https://vip12.meiguanjia.net/shair/reservation!list.action?redirect=1",
                SYNC.SYNC_FUNCTION]
        with mock.patch.object(SYNC.urllib.request, "build_opener") as build:
            for url in urls:
                with self.assertRaisesRegex(ValueError, "invalid_booking_source_destination"):
                    SYNC.source_urlopen(SYNC.urllib.request.Request(url), 9)
            build.assert_not_called()

    def test_rejects_redirect(self):
        with self.assertRaisesRegex(ValueError, "source_redirect_rejected"):
            SYNC.NoSourceRedirect().redirect_request(None, None, 302, "moved", {}, "https://evil.invalid")

    def test_json_read_uses_source_route(self):
        with mock.patch.object(SYNC, "source_urlopen") as open_source:
            open_source.return_value.__enter__.return_value.read.return_value = b'{"code":0}'
            self.assertEqual(SYNC.request_json("https://vip12.meiguanjia.net/shair/metedata!reservationMetadata.action"), {"code":0})
            self.assertEqual(open_source.call_count, 1)


def load_tests(loader, tests, pattern):
    for name in ("scripts.test_mgj_booking_source", "scripts.test_mgj_booking_protocol", "scripts.test_mgj_booking_receipts", "scripts.test_install_mgj_booking_sync"):
        tests.addTests(loader.loadTestsFromName(name))
    return tests
