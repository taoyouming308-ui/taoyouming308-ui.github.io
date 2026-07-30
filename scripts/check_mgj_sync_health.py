#!/usr/bin/env python3
"""Read-only health audit for Meiguanjia sync and care outbound safety."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import ssl
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


SUPABASE_URL = "https://pdssrmpeiuwvxzsgschm.supabase.co"
SUPABASE_KEY = "sb_publishable_MDx4d2QzQpTojF8yLRHIqw_uKQW7A7t"
DEFAULT_REPO_ROOT = Path("/Users/a1/Documents/Codex/2026-06-20/perm-pages")
DEFAULT_HERMES_HOME = Path.home() / ".hermes"

STATUS_RULES = (
    ("booking_sync", "sync_bookings_status.json", 20),
    ("customer_sync", "sync_status.json", 45),
    ("main_keepalive", "mgj_keepalive_status.json", 95),
    ("history_keepalive", "mgj_care_keepalive_status.json", 65),
)

RUNTIME_PAIRS = (
    ("customer_sync", "sync_mgj_customer_profiles.py", "sync_mgj_all.py"),
    ("booking_sync", "sync_mgj_bookings.py", "sync_mgj_bookings.py"),
    ("keepalive", "mgj_keepalive.py", "mgj_keepalive.py"),
    ("care_worker", "care_outbound_worker.py", "care_outbound_worker.py"),
    (
        "care_store_config",
        "care_outbound_store_config.json",
        "care_outbound_store_config.json",
    ),
)


def now_local() -> dt.datetime:
    return dt.datetime.now().astimezone()


def parse_datetime(value: Any) -> dt.datetime | None:
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed


def age_minutes(value: Any, now: dt.datetime) -> float | None:
    parsed = parse_datetime(value)
    if parsed is None:
        return None
    return max(0.0, (now - parsed.astimezone(now.tzinfo)).total_seconds() / 60)


def load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as source:
        value = json.load(source)
    if not isinstance(value, dict):
        raise ValueError("expected JSON object")
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=".mgj-health-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as target:
            json.dump(payload, target, ensure_ascii=False, indent=2)
            target.write("\n")
            target.flush()
            os.fsync(target.fileno())
        os.chmod(temp_name, 0o600)
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def supabase_get(path: str, timeout: int = 15) -> list[dict[str, Any]]:
    request = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Accept": "application/json",
        },
    )
    context = ssl.create_default_context()
    with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
        value = json.loads(response.read().decode("utf-8"))
    if not isinstance(value, list):
        raise RuntimeError("Supabase health query did not return a list")
    return value


def audit_status_files(
    hermes_home: Path,
    now: dt.datetime,
    issues: list[str],
    details: dict[str, Any],
) -> None:
    for label, filename, max_age in STATUS_RULES:
        path = hermes_home / filename
        try:
            status = load_json(path)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            issues.append(f"{label}: 状态文件不可用({type(exc).__name__})")
            continue
        age = age_minutes(status.get("updated_at"), now)
        details[label] = {
            "status": status.get("status"),
            "age_minutes": round(age, 1) if age is not None else None,
        }
        if status.get("status") not in ("healthy", "skipped_busy"):
            issues.append(f"{label}: 状态为{status.get('status') or 'unknown'}")
        if age is None or age > max_age:
            issues.append(f"{label}: 超过{max_age}分钟未更新")


def xiangli_disabled(config: dict[str, Any]) -> bool:
    shop = (config.get("shops") or {}).get("向里造型")
    return (
        isinstance(shop, dict)
        and shop.get("enabled") is False
        and not (shop.get("products") or {})
    )


def audit_runtime(
    repo_root: Path,
    hermes_home: Path,
    issues: list[str],
    details: dict[str, Any],
) -> None:
    runtime_dir = hermes_home / "scripts"
    hashes: dict[str, Any] = {}
    xiangli_states: dict[str, bool] = {}
    for label, source_name, runtime_name in RUNTIME_PAIRS:
        source = repo_root / "scripts" / source_name
        runtime = runtime_dir / runtime_name
        if not source.is_file() or not runtime.is_file():
            issues.append(f"{label}: 源文件或运行副本缺失")
            continue
        source_hash = sha256(source)
        runtime_hash = sha256(runtime)
        hashes[label] = {
            "matched": source_hash == runtime_hash,
            "source_sha256": source_hash,
            "runtime_sha256": runtime_hash,
        }
        if source_hash != runtime_hash:
            issues.append(f"{label}: 仓库与运行副本不一致")
    details["runtime_hashes"] = hashes

    for label, path in (
        ("tracked", repo_root / "scripts" / "care_outbound_store_config.json"),
        ("runtime", runtime_dir / "care_outbound_store_config.json"),
    ):
        try:
            config = load_json(path)
        except (OSError, ValueError, json.JSONDecodeError):
            issues.append(f"xiangli_outbound_{label}: 配置不可读")
            xiangli_states[label] = False
            continue
        disabled = xiangli_disabled(config)
        xiangli_states[label] = disabled
        if not disabled:
            issues.append(f"xiangli_outbound_{label}: 向里自动出库未保持关闭")
    details["xiangli_outbound"] = {
        "enabled": not all(xiangli_states.values()),
        "disabled_checks": xiangli_states,
    }


def audit_live_data(
    now: dt.datetime,
    issues: list[str],
    details: dict[str, Any],
) -> None:
    queue_path = (
        "care_outbound_queue?"
        "select=id,status,created_at,processed_at"
        "&status=in.(pending,processing)&order=created_at.asc&limit=100"
    )
    active = supabase_get(queue_path)
    stale_active = 0
    for row in active:
        timestamp = row.get("processed_at") or row.get("created_at")
        age = age_minutes(timestamp, now)
        if age is None or age > 10:
            stale_active += 1
    details["care_queue"] = {
        "active": len(active),
        "stale_over_10m": stale_active,
    }
    if stale_active:
        issues.append(f"care_queue: {stale_active}条任务超过10分钟未完成")

    service_rows = supabase_get(
        "mgj_service_records?"
        "select=service_date,synced_at&order=service_date.desc&limit=1"
    )
    if not service_rows:
        issues.append("service_records: 没有可用对账记录")
        return
    latest = service_rows[0]
    latest_date = str(latest.get("service_date") or "")
    details["service_records"] = {
        "latest_service_date": latest_date,
        "latest_synced_at": latest.get("synced_at"),
    }
    try:
        lag_days = (now.date() - dt.date.fromisoformat(latest_date)).days
    except ValueError:
        lag_days = 9999
    if lag_days > 14:
        issues.append(f"service_records: 最新服务日期已滞后{lag_days}天")


def run_audit(
    repo_root: Path,
    hermes_home: Path,
    now: dt.datetime | None = None,
    network: bool = True,
) -> dict[str, Any]:
    now = now or now_local()
    issues: list[str] = []
    details: dict[str, Any] = {}
    audit_status_files(hermes_home, now, issues, details)
    audit_runtime(repo_root, hermes_home, issues, details)
    if network:
        try:
            audit_live_data(now, issues, details)
        except Exception as exc:
            issues.append(f"live_audit: 只读检查失败({type(exc).__name__})")
    return {
        "status": "healthy" if not issues else "degraded",
        "checked_at": now.isoformat(timespec="seconds"),
        "issues": issues,
        "details": details,
    }


def render_report(report: dict[str, Any]) -> str:
    if report["status"] == "healthy":
        return "美管加同步健康：预约、客户、会话、护理队列及运行副本均正常"
    lines = ["🔔 美管加同步巡检告警"]
    lines.extend(f"- {issue}" for issue in report.get("issues") or [])
    lines.append("- 向里造型自动出库仍按配置保持关闭")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=DEFAULT_REPO_ROOT)
    parser.add_argument("--hermes-home", type=Path, default=DEFAULT_HERMES_HOME)
    parser.add_argument("--status-path", type=Path)
    parser.add_argument("--no-network", action="store_true")
    parser.add_argument("--quiet-healthy", action="store_true")
    args = parser.parse_args()
    status_path = args.status_path or args.hermes_home / "mgj_sync_health_status.json"
    report = run_audit(
        args.repo_root,
        args.hermes_home,
        network=not args.no_network,
    )
    atomic_write_json(status_path, report)
    if report["status"] != "healthy" or not args.quiet_healthy:
        print(render_report(report))
    return 0 if report["status"] == "healthy" else 1


if __name__ == "__main__":
    raise SystemExit(main())
