#!/usr/bin/env python3
"""Drain already-authorized ZYSYR daily recognition jobs without a browser.

The worker secret is read from macOS Keychain and is never printed or stored in
the progress file. Every database write still runs through the finance actor
recorded on the durable job and the existing auditable finance RPCs.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_ENDPOINT = "https://pdssrmpeiuwvxzsgschm.supabase.co/functions/v1/operations-api"


def keychain_token() -> str:
    result = subprocess.run(
        ["/usr/bin/security", "find-generic-password", "-a", "zysyr",
         "-s", "zysyr-daily-codex-bridge", "-w"],
        capture_output=True, text=True, timeout=10,
    )
    token = result.stdout.strip() if result.returncode == 0 else ""
    if not token:
        raise RuntimeError("未找到本机日报 Codex 通道密钥")
    return token


def call_worker(endpoint: str, token: str, job_id: str, operation: str) -> dict[str, Any]:
    request = urllib.request.Request(
        endpoint,
        data=json.dumps({"operation": operation, "job_id": job_id}).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-zysyr-daily-worker": token},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=150) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"后台执行请求失败 ({exc.code}): {detail}") from exc
    if not isinstance(result, dict):
        raise RuntimeError("后台执行返回格式无效")
    if result.get("error"):
        raise RuntimeError(str(result["error"])[:500])
    return result


def write_progress(path: Path, jobs: dict[str, dict[str, Any]]) -> None:
    snapshot = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "candidate_only": True,
        "finance_confirmation_required": True,
        "jobs": jobs,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("job_ids", nargs="+")
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--progress", type=Path, default=Path("/tmp/zysyr-daily-recognition-progress.json"))
    parser.add_argument("--retry-delay", type=float, default=5.0)
    args = parser.parse_args()
    token = keychain_token()
    jobs: dict[str, dict[str, Any]] = {job_id: {"status": "pending"} for job_id in args.job_ids}
    for job_id in args.job_ids:
        consecutive_errors = 0
        while jobs[job_id].get("status") not in {"completed", "completed_with_errors"}:
            before_completed = int(jobs[job_id].get("completed", 0) or 0)
            try:
                result = call_worker(args.endpoint, token, job_id, "daily_recognition_worker_next")
                job = result.get("job") or {}
                item = result.get("item_result") or {}
                jobs[job_id] = {
                    "status": job.get("status", "unknown"),
                    "month": result.get("month"),
                    "total": job.get("total_count", 0),
                    "success": job.get("success_count", 0),
                    "failed": job.get("failed_count", 0),
                    "remaining": result.get("remaining_count", 0),
                    "completed": result.get("completed_count", 0),
                    "last_report_date": item.get("report_date"),
                    "last_error": item.get("error"),
                }
                consecutive_errors = 0
                print(json.dumps({"job_id": job_id, **jobs[job_id]}, ensure_ascii=False), flush=True)
                if item.get("transient") or (item == {} and jobs[job_id]["status"] not in {"completed", "completed_with_errors"}):
                    time.sleep(max(10.0, args.retry_delay))
            except Exception as exc:  # Keep the durable queue resumable across transient network/service errors.
                consecutive_errors += 1
                jobs[job_id]["runner_error"] = str(exc)[:500]
                print(f"{job_id}: {exc}", file=sys.stderr, flush=True)
                if consecutive_errors >= 8:
                    write_progress(args.progress, jobs)
                    return 2
                # Supabase may close a long HTTP response while the Edge Function
                # and local Codex keep working. Poll the durable job instead of
                # sending another image or moving to another month.
                deadline = time.monotonic() + 210
                while time.monotonic() < deadline:
                    time.sleep(max(5.0, args.retry_delay))
                    try:
                        state = call_worker(args.endpoint, token, job_id, "daily_recognition_worker_read")
                    except Exception:
                        continue
                    job = state.get("job") or {}
                    completed = int(state.get("completed_count", 0) or 0)
                    running = any(item.get("status") == "running" for item in state.get("items", []))
                    jobs[job_id].update({
                        "status": job.get("status", "unknown"), "month": state.get("month"),
                        "total": job.get("total_count", 0), "success": job.get("success_count", 0),
                        "failed": job.get("failed_count", 0), "remaining": state.get("remaining_count", 0),
                        "completed": completed,
                    })
                    if completed > before_completed or not running:
                        consecutive_errors = 0
                        break
            write_progress(args.progress, jobs)
    write_progress(args.progress, jobs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
