"""Narrow signed access to private sync data; no service-role key on this Mac."""
import base64
import json
import os
import ssl
import time
import urllib.parse
import urllib.request

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ENDPOINT = "https://pdssrmpeiuwvxzsgschm.supabase.co/functions/v1/mgj-customer-sync"
KEY_PATH = os.path.expanduser("~/.hermes/mgj-booking-sync-ed25519.pem")
PUBLIC_API_KEY = "sb_publishable_MDx4d2QzQpTojF8yLRHIqw_uKQW7A7t"


def payload_for(method, path, body=None):
    table, _, query = path.partition("?")
    params = urllib.parse.parse_qs(query)
    def value(key, default=""):
        return params.get(key, [default])[0]
    if table == "bookings" and method == "GET":
        dates = params.get("date", [])
        start = next((v[4:] for v in dates if v.startswith("gte.")), "")
        end = next((v.split(".", 1)[1] for v in dates if v.startswith(("lt.", "lte."))), "")
        return {"operation": "booking_phones", "start": start, "end": end,
                "end_inclusive": any(v.startswith("lte.") for v in dates), "limit": int(value("limit", "500"))}
    if table != "customer_profiles":
        raise ValueError("unsupported private sync table")
    if method == "GET":
        if value("phone").startswith("eq."):
            return {"operation": "profile_read", "phone": value("phone")[3:]}
        return {"operation": "profile_scan", "cursor": int(value("id", "gt.0")[3:]), "limit": int(value("limit", "500"))}
    if method not in ("POST", "PATCH") or not isinstance(body, dict):
        raise ValueError("unsupported private sync write")
    key = body.get("phone") if method == "POST" else value("phone")[3:]
    if method == "PATCH" and not value("phone").startswith("eq."):
        raise ValueError("exact phone required")
    if key != body.get("phone"):
        raise ValueError("profile identity mismatch")
    return {"operation": "profile_write", "phone": key, "profile": body, "create": method == "POST"}


def request(payload, timeout=20):
    if os.stat(KEY_PATH).st_mode & 0o077:
        raise PermissionError("同步私钥权限必须为0600")
    with open(KEY_PATH, "rb") as source:
        key = serialization.load_pem_private_key(source.read(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("invalid signing key")
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    ts = str(int(time.time()))
    signature = base64.urlsafe_b64encode(key.sign(b"mgj-customer-sync\n" + ts.encode() + b"." + body)).rstrip(b"=").decode()
    req = urllib.request.Request(ENDPOINT, data=body, headers={
        "Content-Type": "application/json", "apikey": PUBLIC_API_KEY,
        "X-Customer-Sync-Ts": ts, "X-Customer-Sync-Signature": signature,
    })
    with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as response:
        result = json.loads(response.read())
    if payload["operation"] == "daily_consumption_write":
        if not isinstance(result, dict) or result.get('written') != 1 or result.get('count') != payload['source_count']:
            raise RuntimeError('消费快照写入回执无效')
        return result
    if payload["operation"] == "profile_write":
        if not isinstance(result, dict) or result.get("written") != 1:
            raise RuntimeError("客户同步写入回执无效")
        return 204
    if not isinstance(result, dict) or not isinstance(result.get("rows"), list):
        raise RuntimeError("客户同步读取回执无效")
    return result["rows"]
