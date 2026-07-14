#!/usr/bin/env python3
"""Reliable care-usage outbound worker for Meiguanjia.

The App writes protocol-v2 rows with deterministic negative queue ids. This
worker deliberately ignores legacy positive ids. A queue batch is completed
only after the matching Meiguanjia document exists, is audited, and its depot
ids and gram quantities match exactly.

Runtime is disabled in the tracked config until a controlled real-stock test
has been approved and verified.
"""

from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import json
import os
import random
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple


SUPABASE_URL = "https://pdssrmpeiuwvxzsgschm.supabase.co"
SUPABASE_KEY = "sb_publishable_MDx4d2QzQpTojF8yLRHIqw_uKQW7A7t"
PROTOCOL_VERSION = 2
LEGACY_ID_BOUNDARY = 0
MAX_GROUPS_PER_RUN = 3
PROCESSING_STALE_SECONDS = 300

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_STORE_CONFIG = os.path.join(SCRIPT_DIR, "care_outbound_store_config.json")
HERMES_HOME = os.path.expanduser("~/.hermes")
DEFAULT_SESSION_CONFIG = os.path.join(HERMES_HOME, "meiguanjia-care-config.json")
DEFAULT_LOG = os.path.join(HERMES_HOME, "logs", "care_outbound_worker.log")
DEFAULT_LOCK = os.path.join(HERMES_HOME, "logs", "care_outbound_worker.lock")

SSL_CONTEXT = ssl.create_default_context()
SSL_CONTEXT.check_hostname = False
SSL_CONTEXT.verify_mode = ssl.CERT_NONE

USER_AGENTS = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
)


class WorkerFailure(RuntimeError):
    """A safe, explicit failure that happened before an ambiguous write."""


class NeedsReview(RuntimeError):
    """The external result is ambiguous and must not be retried blindly."""


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat()


def load_json(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise WorkerFailure(f"配置格式错误: {path}")
    return value


def parse_timestamp(value: Any) -> Optional[dt.datetime]:
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    try:
        parsed = dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def normalize_quantity(value: Any) -> float:
    try:
        quantity = round(float(value), 3)
    except (TypeError, ValueError):
        raise WorkerFailure(f"护理克数无效: {value!r}")
    if quantity <= 0:
        raise WorkerFailure(f"护理克数必须大于0: {value!r}")
    return quantity


def api_succeeded(result: Mapping[str, Any]) -> bool:
    return str(result.get("code")) == "0" or result.get("success") is True


def product_key(brand: Any, product: Any) -> Tuple[str, str]:
    return (str(brand or "").strip(), str(product or "").strip())


def resolve_employee_id(barber_name: Any, shop: Mapping[str, Any]) -> str:
    """Resolve the stylist to the explicit Meiguanjia employee id for this shop."""
    name = str(barber_name or "").strip()
    if not name:
        raise WorkerFailure("发质分析表未填写发型师，禁止无员工出库")
    employees = shop.get("employees")
    if not isinstance(employees, dict):
        raise WorkerFailure("门店未配置美管加员工映射")
    employee_id = str(employees.get(name) or "").strip()
    if not employee_id:
        raise WorkerFailure(f"发型师“{name}”未配置美管加员工ID")
    if not employee_id.isdigit():
        raise WorkerFailure(f"发型师“{name}”的美管加员工ID无效")
    return employee_id


@dataclass(frozen=True)
class QueueContext:
    queue_id: int
    batch_key: str
    hair_record_id: str
    shop_name: str
    barber: str
    queued_at: str
    brand: str
    product: str
    grams: float


def iter_protocol_contexts(hair_rows: Iterable[Mapping[str, Any]]) -> Iterable[QueueContext]:
    """Yield protocol-v2 queue metadata embedded in hair_records.record_data."""
    for hair_row in hair_rows:
        data = hair_row.get("record_data")
        if not isinstance(data, dict):
            continue
        containers: List[Mapping[str, Any]] = []
        pending = data.get("careOutboundPending")
        if isinstance(pending, dict):
            containers.append(pending)
        batches = data.get("careOutboundBatches")
        if isinstance(batches, list):
            containers.extend(item for item in batches if isinstance(item, dict))
        for batch in containers:
            if batch.get("protocolVersion") != PROTOCOL_VERSION:
                continue
            batch_key = str(batch.get("batchKey") or "").strip()
            hair_record_id = str(
                batch.get("hairRecordId") or hair_row.get("id") or data.get("id") or ""
            ).strip()
            shop_name = str(batch.get("shopName") or "").strip()
            barber = str(batch.get("barber") or hair_row.get("barber") or "").strip()
            queued_at = str(batch.get("queuedAt") or "").strip()
            items = batch.get("items")
            if not batch_key or not hair_record_id or not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                try:
                    queue_id = int(item.get("queueId"))
                    grams = normalize_quantity(item.get("grams"))
                except (TypeError, ValueError, WorkerFailure):
                    continue
                brand, product = product_key(item.get("brand"), item.get("product"))
                if queue_id >= LEGACY_ID_BOUNDARY or not brand or not product:
                    continue
                yield QueueContext(
                    queue_id=queue_id,
                    batch_key=batch_key,
                    hair_record_id=hair_record_id,
                    shop_name=shop_name,
                    barber=barber,
                    queued_at=queued_at,
                    brand=brand,
                    product=product,
                    grams=grams,
                )


def build_context_map(hair_rows: Iterable[Mapping[str, Any]]) -> Dict[int, QueueContext]:
    contexts: Dict[int, QueueContext] = {}
    for context in iter_protocol_contexts(hair_rows):
        existing = contexts.get(context.queue_id)
        if existing and existing != context:
            raise NeedsReview(f"队列ID {context.queue_id} 对应多个不同发质档案")
        contexts[context.queue_id] = context
    return contexts


def group_contexts(
    queue_rows: Sequence[Mapping[str, Any]],
    contexts: Mapping[int, QueueContext],
) -> List[Tuple[str, List[Mapping[str, Any]], List[QueueContext]]]:
    grouped: Dict[str, Tuple[List[Mapping[str, Any]], List[QueueContext]]] = {}
    for row in queue_rows:
        queue_id = int(row["id"])
        context = contexts.get(queue_id)
        if not context:
            continue
        rows, batch_contexts = grouped.setdefault(context.batch_key, ([], []))
        rows.append(row)
        batch_contexts.append(context)
    return [
        (batch_key, rows, batch_contexts)
        for batch_key, (rows, batch_contexts) in sorted(
            grouped.items(),
            key=lambda pair: min(str(row.get("created_at") or "") for row in pair[1][0]),
        )
    ]


def verify_queue_matches_context(
    queue_rows: Sequence[Mapping[str, Any]],
    contexts: Sequence[QueueContext],
) -> None:
    by_id = {int(row["id"]): row for row in queue_rows}
    if {item.queue_id for item in contexts} != set(by_id):
        raise NeedsReview("同一批次的队列行不完整")
    for context in contexts:
        row = by_id[context.queue_id]
        brand, product = product_key(row.get("brand"), row.get("product"))
        grams = normalize_quantity(row.get("grams"))
        if (brand, product) != (context.brand, context.product):
            raise NeedsReview(f"队列 {context.queue_id} 产品信息与发质档案不一致")
        if abs(grams - context.grams) > 0.0001:
            raise NeedsReview(f"队列 {context.queue_id} 克数与发质档案不一致")


def resolve_depot_details(
    contexts: Sequence[QueueContext],
    store_config: Mapping[str, Any],
) -> List[Dict[str, Any]]:
    mappings = store_config.get("products")
    if not isinstance(mappings, dict):
        raise WorkerFailure("门店产品映射缺失")
    details: List[Dict[str, Any]] = []
    for context in contexts:
        brand_map = mappings.get(context.brand)
        depot_id = brand_map.get(context.product) if isinstance(brand_map, dict) else None
        if not depot_id:
            raise WorkerFailure(f"未配置产品映射: {context.brand}/{context.product}")
        details.append(
            {
                "id": None,
                "depotid": str(depot_id),
                "num": context.grams,
                "price": 0,
                "remark": None,
                "depotName": context.brand + context.product,
            }
        )
    return details


def document_matches(
    document: Mapping[str, Any],
    expected_details: Sequence[Mapping[str, Any]],
) -> bool:
    actual: Dict[str, float] = {}
    for detail in document.get("details") or []:
        depot_id = str(detail.get("depotid") or "")
        if not depot_id:
            continue
        actual[depot_id] = round(
            actual.get(depot_id, 0.0) + normalize_quantity(detail.get("num")), 3
        )
    expected: Dict[str, float] = {}
    for detail in expected_details:
        depot_id = str(detail.get("depotid") or "")
        expected[depot_id] = round(
            expected.get(depot_id, 0.0) + normalize_quantity(detail.get("num")), 3
        )
    return actual == expected


class SupabaseClient:
    def __init__(self, base_url: str = SUPABASE_URL, api_key: str = SUPABASE_KEY):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    def request(
        self,
        method: str,
        path: str,
        payload: Optional[Mapping[str, Any]] = None,
        prefer: str = "return=representation",
    ) -> Any:
        url = f"{self.base_url}/rest/v1/{path}"
        headers = {
            "apikey": self.api_key,
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Prefer": prefer,
        }
        body = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=20, context=SSL_CONTEXT) as response:
                raw = response.read().decode()
        except urllib.error.HTTPError as error:
            raw = error.read().decode()
            raise WorkerFailure(f"Supabase HTTP {error.code}: {raw[:300]}") from error
        except Exception as error:
            raise WorkerFailure(f"Supabase请求失败: {error}") from error
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError as error:
            raise WorkerFailure(f"Supabase返回非JSON: {raw[:200]}") from error

    def fetch_candidates(self, limit: int = 50) -> List[Dict[str, Any]]:
        path = (
            "care_outbound_queue?"
            "select=id,brand,product,grams,status,error_message,created_at,processed_at"
            "&id=lt.0&status=in.(pending,processing)"
            f"&order=created_at.asc&limit={int(limit)}"
        )
        rows = self.request("GET", path) or []
        now = utc_now()
        result: List[Dict[str, Any]] = []
        for row in rows:
            if row.get("status") == "pending":
                result.append(row)
                continue
            processed_at = parse_timestamp(row.get("processed_at"))
            if processed_at is None or (now - processed_at).total_seconds() >= PROCESSING_STALE_SECONDS:
                result.append(row)
        return result

    def fetch_hair_rows(self) -> List[Dict[str, Any]]:
        path = (
            "hair_records?select=id,barber,record_data,created_at"
            "&status=neq.deleted&order=created_at.desc&limit=1000"
        )
        return self.request("GET", path) or []

    def fetch_queue_rows(self, queue_ids: Sequence[int]) -> List[Dict[str, Any]]:
        if not queue_ids:
            return []
        values = ",".join(str(int(value)) for value in queue_ids)
        path = (
            "care_outbound_queue?"
            "select=id,brand,product,grams,status,error_message,created_at,processed_at"
            f"&id=in.({values})&order=id.asc"
        )
        return self.request("GET", path) or []

    def claim_many(self, queue_ids: Sequence[int]) -> bool:
        if not queue_ids:
            return True
        values = ",".join(str(int(value)) for value in queue_ids)
        rows = self.request(
            "PATCH",
            f"care_outbound_queue?id=in.({values})&status=eq.pending",
            {"status": "processing", "processed_at": iso_now(), "error_message": None},
        ) or []
        return len(rows) == len(queue_ids)

    def set_status(
        self,
        queue_ids: Sequence[int],
        status: str,
        message: Optional[str] = None,
    ) -> None:
        if not queue_ids:
            return
        values = ",".join(str(int(value)) for value in queue_ids)
        payload = {
            "status": status,
            "processed_at": iso_now(),
            "error_message": (message or None),
        }
        self.request(
            "PATCH",
            f"care_outbound_queue?id=in.({values})",
            payload,
            prefer="return=minimal",
        )


class MeiguanjiaStockClient:
    def __init__(
        self,
        server: str,
        cookies: str,
        parent_shop_id: str,
        sleep_fn=time.sleep,
    ):
        if not cookies:
            raise WorkerFailure("美管加登录Cookie为空")
        self.server = server
        self.cookies = cookies
        self.parent_shop_id = str(parent_shop_id)
        self.sleep_fn = sleep_fn
        self.user_id = self._cookie_value("userId")
        self.token = self._cookie_value("token")
        self._operator_info: Optional[Tuple[str, str, str]] = None

    def _cookie_value(self, name: str) -> str:
        for item in self.cookies.split(";"):
            key, separator, value = item.strip().partition("=")
            if separator and key == name:
                return value
        return ""

    def call(self, action: str, payload: Mapping[str, Any], shop_id: str) -> Dict[str, Any]:
        form = urllib.parse.urlencode(
            {
                "jsonObj": json.dumps(payload, ensure_ascii=False),
                "shopid": str(shop_id),
                "_t": f"{int(time.time() * 1000)}_{random.randint(100, 999)}",
            }
        ).encode()
        url = (
            f"https://{self.server}/shair/{action}"
            f"?_={int(time.time() * 1000)}"
        )
        headers = {
            "Cookie": self.cookies,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": random.choice(USER_AGENTS),
            "Referer": f"https://{self.server}/shair/components/stock/index.html#/stockBill",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "X-Requested-With": "XMLHttpRequest",
            "Origin": f"https://{self.server}",
        }
        if self.token:
            headers["Token"] = self.token
        request = urllib.request.Request(url, data=form, headers=headers)
        self.sleep_fn(random.uniform(0.35, 0.9))
        try:
            with urllib.request.urlopen(request, timeout=20, context=SSL_CONTEXT) as response:
                raw = response.read().decode()
        except urllib.error.HTTPError as error:
            raw = error.read().decode()
            if error.code == 403 or "ErrorException" in raw:
                raise NeedsReview("美管加接口被拦截，未继续重试") from error
            raise WorkerFailure(f"美管加 HTTP {error.code}: {raw[:200]}") from error
        except Exception as error:
            raise NeedsReview(f"美管加请求结果不明确: {error}") from error
        if "ErrorException" in raw:
            raise NeedsReview("美管加接口被拦截，未继续重试")
        try:
            result = json.loads(raw)
        except json.JSONDecodeError as error:
            raise NeedsReview(f"美管加返回非JSON: {raw[:160]}") from error
        if not isinstance(result, dict):
            raise NeedsReview("美管加返回格式异常")
        return result

    def operator_info(self) -> Tuple[str, str, str]:
        if self._operator_info:
            return self._operator_info
        url = f"https://{self.server}/shair/metedata!reservationMetadata.action"
        headers = {
            "Cookie": self.cookies,
            "Accept": "application/json, text/plain, */*",
            "User-Agent": random.choice(USER_AGENTS),
        }
        if self.token:
            headers["Token"] = self.token
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=15, context=SSL_CONTEXT) as response:
                result = json.loads(response.read().decode())
        except Exception as error:
            raise WorkerFailure(f"读取美管加登录员工失败: {error}") from error
        if not api_succeeded(result):
            raise WorkerFailure("美管加登录状态无效")
        content = result.get("content") if isinstance(result.get("content"), dict) else {}
        user = content.get("userInfo") if isinstance(content.get("userInfo"), dict) else {}
        user_id = str(user.get("userId") or self.user_id or "")
        user_name = str(user.get("name") or user.get("userName") or "")
        session_shop_id = str(user.get("shopId") or "")
        if not user_id or not user_name:
            raise WorkerFailure("美管加登录员工信息不完整")
        self._operator_info = (user_id, user_name, session_shop_id)
        return self._operator_info

    def list_outbound(
        self,
        shop_id: str,
        queued_at: str,
        page_size: int = 200,
    ) -> List[Dict[str, Any]]:
        queued = parse_timestamp(queued_at) or utc_now()
        start = (queued - dt.timedelta(days=1)).date().isoformat()
        end = (utc_now() + dt.timedelta(days=1)).date().isoformat()
        result = self.call(
            "stockApi!getOutDepotList.action",
            {
                "shopIds": [str(shop_id), str(shop_id)],
                "period": f"{start}_{end}",
                "pageNumber": 0,
                "pageSize": page_size,
                "outdepot": {
                    "outwaretype": None,
                    "status": None,
                    "outobject": None,
                },
            },
            shop_id,
        )
        if not api_succeeded(result):
            raise WorkerFailure(
                f"读取美管加出库单失败: {result.get('code')} {result.get('message')}"
            )
        content = result.get("content")
        return content if isinstance(content, list) else []

    def find_document(
        self,
        shop_id: str,
        queued_at: str,
        remark: str,
    ) -> Optional[Dict[str, Any]]:
        matches = [
            item
            for item in self.list_outbound(shop_id, queued_at)
            if str(item.get("remark") or "") == remark
        ]
        if len(matches) > 1:
            raise NeedsReview(f"美管加存在多个相同幂等标记的出库单: {remark}")
        return matches[0] if matches else None

    def create_document(
        self,
        shop_id: str,
        remark: str,
        details: Sequence[Mapping[str, Any]],
        employee_id: str,
    ) -> None:
        operator_id, operator_name, session_shop_id = self.operator_info()
        if session_shop_id and session_shop_id != str(shop_id):
            raise WorkerFailure(
                f"美管加当前登录门店为 {session_shop_id}，目标门店为 {shop_id}"
            )
        result = self.call(
            "stockApi!saveOutDepot.action",
            {
                "shopId": str(shop_id),
                "outdepot": {
                    "id": None,
                    "shopid": str(shop_id),
                    "parentShopId": self.parent_shop_id,
                    "outwaretype": "8",
                    "outdate": int(time.time() * 1000),
                    "remark": remark,
                    "price": 0,
                    "totoalNum": round(
                        sum(normalize_quantity(item.get("num")) for item in details), 3
                    ),
                    "operatid": operator_id,
                    "operatName": operator_name,
                    "employeeid": str(employee_id),
                    "type": -1,
                    "details": list(details),
                },
            },
            shop_id,
        )
        if not api_succeeded(result):
            raise WorkerFailure(
                f"创建美管加出库单失败: {result.get('code')} {result.get('message')}"
            )

    def audit_document(self, shop_id: str, document: Mapping[str, Any]) -> None:
        document_id = str(document.get("id") or "")
        if not document_id:
            raise NeedsReview("美管加出库单缺少ID，无法审核")
        metadata_id, metadata_name, session_shop_id = self.operator_info()
        if session_shop_id and session_shop_id != str(shop_id):
            raise WorkerFailure(
                f"美管加当前登录门店为 {session_shop_id}，目标门店为 {shop_id}"
            )
        operator_id = metadata_id or self.user_id or str(document.get("operatid") or "")
        operator_name = metadata_name or str(document.get("operatName") or "")
        result = self.call(
            "stockApi!auditOutDepot.action",
            {
                "outdepot": {
                    "id": document_id,
                    "operatid": operator_id,
                    "auditid": operator_id,
                    "type": -1,
                    "outwaretype": str(document.get("outwaretype") or "8"),
                    "status": 0,
                    "parentShopId": self.parent_shop_id,
                    "operatName": operator_name,
                },
                "shopid": str(shop_id),
            },
            shop_id,
        )
        if not api_succeeded(result):
            raise NeedsReview(
                f"美管加审核结果不明确: {result.get('code')} {result.get('message')}"
            )

    def delete_unaudited_document(
        self,
        shop_id: str,
        document: Mapping[str, Any],
    ) -> None:
        if str(document.get("status")) != "0" or (document.get("details") or []):
            raise WorkerFailure("只允许删除未审核且无明细的测试空壳单")
        document_id = str(document.get("id") or "")
        if not document_id:
            raise WorkerFailure("测试空壳单缺少ID")
        operator_id, _, session_shop_id = self.operator_info()
        if session_shop_id and session_shop_id != str(shop_id):
            raise WorkerFailure("当前登录门店与测试空壳单不一致")
        result = self.call(
            "stockApi!deleteOutDepot.action",
            {
                "outdepot": {
                    "id": document_id,
                    "operatid": operator_id,
                },
                "shopid": str(shop_id),
            },
            shop_id,
        )
        if not api_succeeded(result):
            raise WorkerFailure(
                f"删除测试空壳单失败: {result.get('code')} {result.get('message')}"
            )


class CareOutboundWorker:
    def __init__(
        self,
        store_config: Mapping[str, Any],
        supabase: SupabaseClient,
        stock: Optional[MeiguanjiaStockClient],
        logger=print,
    ):
        self.store_config = store_config
        self.supabase = supabase
        self.stock = stock
        self.log = logger

    def _shop(self, shop_name: str) -> Mapping[str, Any]:
        shops = self.store_config.get("shops")
        shop = shops.get(shop_name) if isinstance(shops, dict) else None
        if not isinstance(shop, dict) or not shop.get("enabled"):
            raise WorkerFailure(f"门店未启用自动出库: {shop_name or '未知门店'}")
        return shop

    def process_group(
        self,
        batch_key: str,
        queue_rows: Sequence[Mapping[str, Any]],
        contexts: Sequence[QueueContext],
        dry_run: bool = False,
    ) -> None:
        queue_ids = sorted({int(row["id"]) for row in queue_rows})
        if not contexts:
            raise NeedsReview("队列缺少发质档案上下文")
        shop_names = {item.shop_name for item in contexts}
        hair_ids = {item.hair_record_id for item in contexts}
        if len(shop_names) != 1 or len(hair_ids) != 1:
            raise NeedsReview("同一批次跨越多个门店或发质档案")
        verify_queue_matches_context(queue_rows, contexts)
        shop_name = next(iter(shop_names))
        shop = self._shop(shop_name)
        shop_id = str(shop.get("shop_id") or "")
        if not shop_id:
            raise WorkerFailure(f"门店缺少美管加shopId: {shop_name}")
        employee_id = resolve_employee_id(contexts[0].barber, shop)
        details = resolve_depot_details(contexts, shop)
        remark = f"护理App|{batch_key}"
        self.log(
            f"批次 {batch_key}: {shop_name} / {contexts[0].barber or '未填写'} / "
            f"{len(details)}项 / 队列{','.join(map(str, queue_ids))}"
        )
        if dry_run:
            self.log(
                "只读模拟: "
                + json.dumps(
                    {
                        "shopId": shop_id,
                        "employeeid": employee_id,
                        "employeeName": contexts[0].barber,
                        "remark": remark,
                        "details": details,
                    },
                    ensure_ascii=False,
                )
            )
            return
        if not self.stock:
            raise WorkerFailure("未初始化美管加库存客户端")
        pending_ids = [int(row["id"]) for row in queue_rows if row.get("status") == "pending"]
        if not self.supabase.claim_many(pending_ids):
            raise NeedsReview("同批次队列未能完整取得处理权")

        document = self.stock.find_document(shop_id, contexts[0].queued_at, remark)
        if document and not document_matches(document, details):
            raise NeedsReview("已存在的美管加出库单与护理克数不一致")
        if document and str(document.get("employeeid") or "") != employee_id:
            raise NeedsReview("已存在的美管加出库单员工为空或与发型师不一致")
        if not document:
            self.stock.create_document(shop_id, remark, details, employee_id)
            for attempt in range(3):
                document = self.stock.find_document(shop_id, contexts[0].queued_at, remark)
                if document:
                    break
                if attempt < 2:
                    time.sleep(1.0 + attempt)
            if not document:
                raise NeedsReview("创建接口已返回成功，但回查不到对应美管加出库单")
        if not document_matches(document, details):
            raise NeedsReview("美管加出库单明细与护理克数不一致")
        if str(document.get("employeeid") or "") != employee_id:
            raise NeedsReview("美管加出库单未正确选择发型师员工")
        if str(document.get("status")) != "1":
            self.stock.audit_document(shop_id, document)
            document = self.stock.find_document(shop_id, contexts[0].queued_at, remark)
        if not document or str(document.get("status")) != "1":
            raise NeedsReview("美管加出库单未达到已审核状态")
        if not document_matches(document, details):
            raise NeedsReview("审核后的美管加出库明细与护理克数不一致")
        if str(document.get("employeeid") or "") != employee_id:
            raise NeedsReview("审核后的美管加出库单员工与发型师不一致")
        bill_no = str(document.get("billno") or document.get("id") or "")
        self.supabase.set_status(queue_ids, "completed", f"美管加单号:{bill_no} 已审核")
        self.log(f"完成: {batch_key} -> {bill_no}")

    def run(self, dry_run: bool = False) -> int:
        candidates = self.supabase.fetch_candidates()
        if not candidates:
            self.log("没有协议v2待处理任务")
            return 0
        contexts = build_context_map(self.supabase.fetch_hair_rows())
        missing_ids = [int(row["id"]) for row in candidates if int(row["id"]) not in contexts]
        if missing_ids and not dry_run:
            self.supabase.set_status(
                missing_ids,
                "needs_review",
                "缺少协议v2发质档案上下文，禁止自动出库",
            )
        groups = group_contexts(candidates, contexts)[:MAX_GROUPS_PER_RUN]
        if not groups:
            self.log("没有可安全处理的协议v2批次")
            return 0
        failures = 0
        for batch_key, rows, batch_contexts in groups:
            queue_ids = [int(row["id"]) for row in rows]
            try:
                self.process_group(batch_key, rows, batch_contexts, dry_run=dry_run)
            except NeedsReview as error:
                failures += 1
                self.log(f"待人工核对 {batch_key}: {error}")
                if not dry_run:
                    self.supabase.set_status(queue_ids, "needs_review", str(error)[:500])
            except WorkerFailure as error:
                failures += 1
                self.log(f"安全失败 {batch_key}: {error}")
                if not dry_run:
                    self.supabase.set_status(queue_ids, "failed", str(error)[:500])
            except Exception as error:
                failures += 1
                self.log(f"未知异常 {batch_key}: {error}")
                if not dry_run:
                    self.supabase.set_status(
                        queue_ids,
                        "needs_review",
                        f"未知异常，禁止自动重试: {str(error)[:420]}",
                    )
        return 1 if failures else 0


def make_logger(path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)

    def write(message: str) -> None:
        line = f"[{dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {message}"
        print(line)
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")

    return write


def acquire_lock(path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    handle = open(path, "a+", encoding="utf-8")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        handle.close()
        return None
    handle.seek(0)
    handle.truncate()
    handle.write(str(os.getpid()))
    handle.flush()
    return handle


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="护理用量同步美管加出库")
    parser.add_argument("--dry-run", action="store_true", help="只打印将处理的载荷")
    parser.add_argument("--config", default=DEFAULT_STORE_CONFIG)
    parser.add_argument("--session-config", default=DEFAULT_SESSION_CONFIG)
    parser.add_argument("--log", default=DEFAULT_LOG)
    parser.add_argument("--lock", default=DEFAULT_LOCK)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    logger = make_logger(args.log)
    lock = acquire_lock(args.lock)
    if lock is None:
        logger("已有护理出库执行器运行，本次跳过")
        return 0
    try:
        store_config = load_json(args.config)
        if not args.dry_run and not store_config.get("runtime_enabled"):
            logger("真实出库尚未启用；请先完成受控测试")
            return 0
        session = load_json(args.session_config)
        cookies = str(session.get("cookies") or session.get("cookie") or "")
        stock = None
        if not args.dry_run:
            stock = MeiguanjiaStockClient(
                server=str(store_config.get("server") or "vip12.meiguanjia.net"),
                cookies=cookies,
                parent_shop_id=str(store_config.get("parent_shop_id") or ""),
            )
        worker = CareOutboundWorker(
            store_config=store_config,
            supabase=SupabaseClient(),
            stock=stock,
            logger=logger,
        )
        return worker.run(dry_run=args.dry_run)
    except WorkerFailure as error:
        logger(f"启动失败: {error}")
        return 1
    finally:
        fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
        lock.close()


if __name__ == "__main__":
    sys.exit(main())
