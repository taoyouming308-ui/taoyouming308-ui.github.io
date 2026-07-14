#!/usr/bin/env python3
"""Safe server-side kernel for a Meiguanjia inventory connector.

This module never loads credentials from request data. Writes are disabled by
default and require deterministic validation plus a per-capability allowlist.
DeepSeek output is advisory data only and is intentionally not accepted by the
write execution method.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional, Sequence

from care_outbound_worker import MeiguanjiaStockClient, NeedsReview, WorkerFailure, api_succeeded


DEFAULT_SESSION_PATH = os.path.expanduser("~/.hermes/meiguanjia-config.json")
DEFAULT_AUDIT_PATH = os.path.expanduser("~/.hermes/mgj_data/inventory_connector.sqlite3")
ALLOWED_ROLES = frozenset({"inventory_admin", "super_admin"})
READ_ACTIONS = {
    "products": "stockApi!getAllDepotList.action",
    "inbound_documents": "stockApi!getIntoDepotList.action",
    "outbound_documents": "stockApi!getOutDepotList.action",
    "stock_ledger": "stockApi!getDepotInoutBills.action",
}
WRITE_ACTIONS = frozenset({"create_product", "inbound", "outbound", "stocktake"})


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def payload_hash(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class WriteCommand:
    operation: str
    idempotency_key: str
    actor_id: str
    actor_role: str
    shop_id: str
    items: Sequence[Mapping[str, Any]]
    approved: bool
    reason: str = ""


class AuditJournal:
    def __init__(self, path: str = DEFAULT_AUDIT_PATH):
        self.path = path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with self._connect() as db:
            db.execute("""create table if not exists inventory_audit (
                id integer primary key autoincrement,
                created_at integer not null,
                idempotency_key text,
                operation text not null,
                actor_id text,
                shop_id text,
                payload_hash text not null,
                status text not null,
                external_id text,
                error text
            )""")
            db.execute("create unique index if not exists inventory_audit_idem on inventory_audit(idempotency_key) where idempotency_key is not null")

    def _connect(self):
        return sqlite3.connect(self.path)

    def get(self, key: str) -> Optional[Dict[str, Any]]:
        with self._connect() as db:
            row = db.execute("select operation,payload_hash,status,external_id,error from inventory_audit where idempotency_key=?", (key,)).fetchone()
        if not row:
            return None
        return dict(zip(("operation", "payload_hash", "status", "external_id", "error"), row))

    def record(self, command: WriteCommand, digest: str, status: str, external_id: str = "", error: str = "") -> None:
        with self._connect() as db:
            db.execute("insert into inventory_audit(created_at,idempotency_key,operation,actor_id,shop_id,payload_hash,status,external_id,error) values(?,?,?,?,?,?,?,?,?)", (int(time.time()), command.idempotency_key, command.operation, command.actor_id, command.shop_id, digest, status, external_id or None, error or None))

    def update(self, key: str, status: str, external_id: str = "", error: str = "") -> None:
        with self._connect() as db:
            db.execute("update inventory_audit set status=?,external_id=?,error=? where idempotency_key=?", (status, external_id or None, error or None, key))

    def exceptions(self) -> list[Dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute("select idempotency_key,operation,shop_id,status,error from inventory_audit where status in ('failed','needs_review') order by id desc").fetchall()
        keys = ("idempotency_key", "operation", "shop_id", "status", "error")
        return [dict(zip(keys, row)) for row in rows]


class InventoryConnector:
    def __init__(self, config: Mapping[str, Any], client: MeiguanjiaStockClient, journal: AuditJournal):
        self.config = config
        self.client = client
        self.journal = journal

    @classmethod
    def from_local_session(cls, connector_config: Mapping[str, Any], journal_path: str = DEFAULT_AUDIT_PATH):
        with open(DEFAULT_SESSION_PATH, encoding="utf-8") as handle:
            session = json.load(handle)
        client = MeiguanjiaStockClient(
            server=str(session.get("server") or connector_config.get("server") or "vip12.meiguanjia.net"),
            cookies=str(session.get("cookies") or ""),
            parent_shop_id=str(connector_config.get("parent_shop_id") or ""),
        )
        return cls(connector_config, client, AuditJournal(journal_path))

    def read(self, resource: str, shop_id: str, **filters: Any) -> Any:
        if resource not in READ_ACTIONS:
            raise WorkerFailure(f"不支持的只读资源: {resource}")
        allowed = set(self.config.get("allowed_shop_ids") or [])
        if str(shop_id) not in {str(value) for value in allowed}:
            raise WorkerFailure("门店不在连接器允许范围")
        payload = {"shopId": str(shop_id), "parentShopId": str(self.config.get("parent_shop_id") or "")}
        payload.update(filters)
        result = self.client.call(READ_ACTIONS[resource], payload, str(shop_id))
        if not api_succeeded(result):
            raise WorkerFailure(f"美管加只读接口失败: code={result.get('code')} message={result.get('message')}")
        return result.get("content")

    def validate(self, command: WriteCommand) -> str:
        if command.operation not in WRITE_ACTIONS:
            raise WorkerFailure("不支持的库存写操作")
        if not command.approved:
            raise WorkerFailure("库存写操作缺少显式批准")
        if command.actor_role not in ALLOWED_ROLES or not command.actor_id.strip():
            raise WorkerFailure("库存写操作权限不足")
        if len(command.idempotency_key.strip()) < 12:
            raise WorkerFailure("幂等键无效")
        allowed = {str(value) for value in self.config.get("allowed_shop_ids") or []}
        if command.shop_id not in allowed:
            raise WorkerFailure("门店不在连接器允许范围")
        if not command.items:
            raise WorkerFailure("库存写操作没有明细")
        normalized = []
        for item in command.items:
            depot_id = str(item.get("depot_id") or "").strip()
            if not depot_id.isdigit():
                raise WorkerFailure("商品必须使用明确的美管加 depotId")
            try:
                quantity = round(float(item.get("quantity")), 3)
            except (TypeError, ValueError) as exc:
                raise WorkerFailure("库存数量无效") from exc
            if quantity <= 0:
                raise WorkerFailure("库存数量必须大于 0")
            normalized.append({"depot_id": depot_id, "quantity": quantity})
        return payload_hash({"operation": command.operation, "shop_id": command.shop_id, "items": normalized, "reason": command.reason})

    def execute(self, command: WriteCommand) -> Dict[str, Any]:
        digest = self.validate(command)
        existing = self.journal.get(command.idempotency_key)
        if existing:
            if existing["payload_hash"] != digest:
                raise NeedsReview("同一幂等键对应不同库存载荷")
            return {"status": existing["status"], "external_id": existing["external_id"], "deduplicated": True}
        self.journal.record(command, digest, "validated")
        enabled = bool(self.config.get("writes_enabled")) and command.operation in set(self.config.get("enabled_write_operations") or [])
        if not enabled:
            self.journal.update(command.idempotency_key, "failed", error="write_capability_disabled")
            raise WorkerFailure("该库存写能力尚未通过逐项验证，已阻止执行")
        # Deliberately no generic live writer in MVP. Each operation must be
        # implemented and verified separately before its capability is enabled.
        self.journal.update(command.idempotency_key, "needs_review", error="writer_not_implemented")
        raise NeedsReview("写能力开关已开启但确定性执行器尚未实现")


def deepseek_advisory(raw_fields: Mapping[str, Any], explanation: str = "") -> Dict[str, Any]:
    """Wrap model output so it cannot be mistaken for an executable command."""
    return {
        "advisory_only": True,
        "proposed_mapping": dict(raw_fields),
        "explanation": str(explanation),
        "allowed_uses": ["field_identification", "schema_summary", "exception_explanation", "mapping_suggestion"],
        "prohibited_uses": ["inventory_quantity_decision", "write_execution", "approval"],
    }
