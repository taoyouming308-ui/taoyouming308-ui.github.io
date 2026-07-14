#!/usr/bin/env python3
"""Keep a Meiguanjia session alive with configurable isolated state."""

import argparse
import fcntl
import http.cookiejar
import json
import os
import ssl
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import datetime


CONFIG_PATH = os.path.expanduser("~/.hermes/meiguanjia-config.json")
AUTH_PATH = os.path.expanduser("~/.hermes/meiguanjia-auth.json")
LOCK_PATH = "/tmp/sync_mgj_all.lock"
STATUS_PATH = os.path.expanduser("~/.hermes/mgj_keepalive_status.json")
DEFAULT_SERVER = "vip12.meiguanjia.net"


def now_iso():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def load_json(path):
    with open(path, encoding="utf-8") as source:
        value = json.load(source)
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def atomic_write_json(path, value, mode=0o600):
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=".mgj-", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as target:
            json.dump(value, target, ensure_ascii=False, indent=2)
            target.write("\n")
            target.flush()
            os.fsync(target.fileno())
        os.chmod(temp_path, mode)
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def write_status(status, **details):
    payload = {"status": status, "updated_at": now_iso()}
    payload.update(details)
    atomic_write_json(STATUS_PATH, payload)


def acquire_sync_lock():
    lock_file = open(LOCK_PATH, "w", encoding="utf-8")
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock_file.close()
        return None
    lock_file.write(str(os.getpid()))
    lock_file.flush()
    return lock_file


def request_json(url, cookie="", data=None, timeout=15):
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36",
    }
    if cookie:
        headers["Cookie"] = cookie
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8"
    request = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(
        request,
        timeout=timeout,
        context=ssl.create_default_context(),
    ) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))


def check_session(server, cookie):
    if not cookie:
        return False, "missing_cookie"
    try:
        result = request_json(
            f"https://{server}/shair/metedata!reservationMetadata.action",
            cookie=cookie,
            timeout=10,
        )
        code = result.get("code")
        return code == 0, f"code={code}"
    except Exception as exc:
        return False, f"{type(exc).__name__}:{exc}"


def login(server, username, password):
    cookie_jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(cookie_jar),
        urllib.request.HTTPSHandler(context=ssl.create_default_context()),
    )
    body = urllib.parse.urlencode({
        "login": username,
        "passwd": password,
        "rand": "",
        "mobileFlag": "false",
    }).encode()
    request = urllib.request.Request(
        f"https://{server}/shair/loginAction!ajaxLogin.action?v=mgj",
        data=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Origin": f"https://{server}",
            "Referer": f"https://{server}/shair/",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36",
        },
    )
    with opener.open(request, timeout=15) as response:
        result = json.loads(response.read().decode("utf-8", errors="replace"))
    if result.get("code") != 7:
        raise RuntimeError(f"login code={result.get('code')}")
    parts = [f"{cookie.name}={cookie.value}" for cookie in cookie_jar]
    if not any(part.startswith("JSESSIONID=") for part in parts):
        raise RuntimeError("login response missing JSESSIONID")
    return "; ".join(parts)


def save_session(config, cookie, source):
    timestamp = now_iso()
    updated = dict(config)
    updated.update({
        "cookies": cookie,
        "cookie_server": updated.get("server") or DEFAULT_SERVER,
        "cookie_source": source,
        "saved_at": timestamp,
        "last_keepalive": timestamp,
    })
    atomic_write_json(CONFIG_PATH, updated)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="美管加会话校验与按需续期")
    parser.add_argument("--config", default=CONFIG_PATH)
    parser.add_argument("--auth", default=AUTH_PATH)
    parser.add_argument("--lock", default=LOCK_PATH)
    parser.add_argument("--status", default=STATUS_PATH)
    return parser.parse_args(argv)


def main(argv=None):
    global CONFIG_PATH, AUTH_PATH, LOCK_PATH, STATUS_PATH
    args = parse_args(argv)
    CONFIG_PATH = os.path.expanduser(args.config)
    AUTH_PATH = os.path.expanduser(args.auth)
    LOCK_PATH = os.path.expanduser(args.lock)
    STATUS_PATH = os.path.expanduser(args.status)
    lock_file = acquire_sync_lock()
    if lock_file is None:
        write_status("skipped_busy", reason="customer_sync_running")
        return 0

    try:
        config = load_json(CONFIG_PATH)
        server = str(config.get("server") or DEFAULT_SERVER)
        cookie = str(config.get("cookies") or "")
        valid, reason = check_session(server, cookie)
        if valid:
            save_session(config, cookie, "keepalive_verified")
            write_status("healthy", action="verified", server=server)
            print("healthy: existing session verified")
            return 0

        auth = load_json(AUTH_PATH)
        username = str(auth.get("login") or "")
        password = str(auth.get("password") or "")
        if not username or not password:
            raise RuntimeError("missing login credentials")
        new_cookie = login(server, username, password)
        valid, verify_reason = check_session(server, new_cookie)
        if not valid:
            raise RuntimeError(f"new session verification failed: {verify_reason}")
        save_session(config, new_cookie, "keepalive_relogin")
        write_status("healthy", action="relogin", server=server, previous=reason)
        print("healthy: session renewed")
        return 0
    except Exception as exc:
        write_status(
            "degraded",
            error=f"{type(exc).__name__}:{exc}",
        )
        print(f"degraded: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        lock_file.close()


if __name__ == "__main__":
    sys.exit(main())
