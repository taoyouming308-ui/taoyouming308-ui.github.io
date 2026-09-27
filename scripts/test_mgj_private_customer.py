import base64
import io
import json
import os
import tempfile
import unittest
from unittest import mock
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from scripts import mgj_private_customer as client


class PrivateClientTests(unittest.TestCase):
    def test_narrow_payloads(self):
        p = client.payload_for("GET", "bookings?select=customer_phone&date=gte.2026-09-27&date=lte.2026-09-29&limit=500")
        self.assertEqual(p, {"operation": "booking_phones", "start": "2026-09-27", "end": "2026-09-29", "end_inclusive": True, "limit": 500})
        self.assertEqual(client.payload_for("GET", "customer_profiles?phone=eq.%2B8613800000000&limit=1")["phone"], "+8613800000000")
        self.assertEqual(client.payload_for("GET", "customer_profiles?id=gt.88&limit=500")["cursor"], 88)
        with self.assertRaises(ValueError):
            client.payload_for("DELETE", "customer_profiles?phone=eq.13800000000")
        with self.assertRaises(ValueError):
            client.payload_for("PATCH", "customer_profiles?phone=eq.13800000000", {"phone": "13800000001"})

    def test_signature_and_no_public_rest_fallback(self):
        key = Ed25519PrivateKey.generate()
        pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        with mock.patch.object(client.os, "stat", return_value=mock.Mock(st_mode=0o600)), \
             mock.patch("builtins.open", return_value=io.BytesIO(pem)), \
             mock.patch.object(client.urllib.request, "urlopen") as urlopen:
            urlopen.return_value.__enter__.return_value.read.return_value = b'{"rows":[]}'
            self.assertEqual(client.request({"operation": "profile_scan", "cursor": 0, "limit": 1}), [])
            req = urlopen.call_args.args[0]
            ts = req.get_header("X-customer-sync-ts")
            sig = base64.urlsafe_b64decode(req.get_header("X-customer-sync-signature") + "==")
            key.public_key().verify(sig, b"mgj-customer-sync\n" + ts.encode() + b"." + req.data)
            self.assertEqual(req.full_url, client.ENDPOINT)


if __name__ == "__main__":
    unittest.main()
