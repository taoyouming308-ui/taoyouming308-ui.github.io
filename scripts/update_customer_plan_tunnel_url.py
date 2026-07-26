#!/usr/bin/env python3
"""Publish a newly-created customer-plan Quick Tunnel URL only after probing it."""

import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

RUNTIME_REPO = Path(os.environ.get("CUSTOMER_PLAN_PUBLISH_REPO", "/Users/a1/Documents/Codex/2026-07-25/realtime-voice-chat/work/customer-plan-publisher"))
TUNNEL_LOG = Path(os.environ.get("CUSTOMER_PLAN_TUNNEL_LOG", "/Users/a1/.hermes/logs/customer-plan-tunnel.log"))
REMOTE = os.environ.get("CUSTOMER_PLAN_GIT_REMOTE", "github")
URL_PATTERN = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")


def latest_tunnel_base(log_text):
    matches = URL_PATTERN.findall(log_text or "")
    return matches[-1] if matches else ""


def endpoint_responds(base_url):
    if not base_url:
        return False
    request = urllib.request.Request(base_url.rstrip("/") + "/api/codex-plan", method="GET")
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status in (200, 400)
    except urllib.error.HTTPError as error:
        # The endpoint correctly rejects a request without a customer phone.
        return error.code == 400
    except (urllib.error.URLError, TimeoutError):
        return False


def run_git(*args):
    return subprocess.run(
        ["git", "-C", str(RUNTIME_REPO), *args],
        check=True,
        text=True,
        capture_output=True,
    )


def write_config(path, url):
    payload = {
        "url": url,
        "service": "customer-plan-codex",
        "updated": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
    }
    fd, temporary = tempfile.mkstemp(prefix=".customer-plan-url-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
            handle.write("\n")
        os.replace(temporary, path)
    except Exception:
        os.unlink(temporary)
        raise


def main():
    try:
        log_text = TUNNEL_LOG.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        print("customer-plan tunnel log is not available", file=sys.stderr)
        return 1

    base_url = latest_tunnel_base(log_text)
    if not endpoint_responds(base_url):
        print("customer-plan tunnel candidate is not healthy", file=sys.stderr)
        return 1

    if not (RUNTIME_REPO / ".git").exists():
        print("customer-plan publisher checkout is not available", file=sys.stderr)
        return 1

    run_git("fetch", REMOTE, "main")
    # This is a dedicated publisher worktree. Reset only that disposable
    # worktree before applying a freshly discovered tunnel address.
    run_git("reset", "--hard", f"{REMOTE}/main")
    config_path = RUNTIME_REPO / "customer-plan-url.json"
    old_url = ""
    try:
        old_url = json.loads(config_path.read_text(encoding="utf-8")).get("url", "")
    except (OSError, json.JSONDecodeError):
        pass
    url = base_url + "/api/codex-plan"
    if old_url == url:
        print("customer-plan tunnel URL unchanged")
        return 0

    write_config(config_path, url)
    run_git("add", "customer-plan-url.json")
    run_git("commit", "-m", "chore: refresh customer plan tunnel URL")
    run_git("push", REMOTE, "HEAD:main")
    print("customer-plan tunnel URL refreshed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
