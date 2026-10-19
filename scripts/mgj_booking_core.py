"""Booking orchestration, with no HTTP or production write implementation.

The adapter contract is deliberately independent of Meiguanjia's unverified
create endpoint. See docs/mgj-quick-booking.md before implementing an adapter.
"""

from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile


CHINA = timezone(timedelta(hours=8))
MAX_AGE = timedelta(seconds=60)


class Blocked(ValueError):
    """Fail closed; messages must never include credentials or raw responses."""


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    separators=(",", ":")).encode()).hexdigest()


def phone(value):
    value = re.sub(r"[\s-]", "", str(value))
    if value.startswith("+86"):
        value = value[3:]
    if not re.fullmatch(r"1[3-9][0-9]{9}", value):
        raise Blocked("需要完整中国大陆手机号，不能使用尾号或模糊匹配")
    return value


def instant(value):
    try:
        parsed = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        raise Blocked("时间必须是带时区的 ISO 日期时间") from None
    if parsed.tzinfo is None or parsed.second or parsed.microsecond:
        raise Blocked("预约时间必须带时区且精确到分钟")
    return parsed.astimezone(CHINA)


def observed_time(value):
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            raise ValueError()
        return parsed.astimezone(CHINA)
    except (TypeError, ValueError):
        raise Blocked("读取时间缺少有效时区") from None


def identifier(value):
    if isinstance(value, bool) or not isinstance(value, (str, int)) or not str(value).strip():
        raise Blocked("源记录缺少稳定 ID")
    return str(value).strip()


@dataclass(frozen=True)
class Request:
    shop_id: str
    customer_phone: str
    barber: str
    services: tuple
    start: str
    duration_minutes: int

    @classmethod
    def parse(cls, value):
        if not isinstance(value, dict) or set(value) != set(cls.__dataclass_fields__):
            raise Blocked("预约请求字段不完整或含未知字段")
        duration = value["duration_minutes"]
        if type(duration) is not int or not 1 <= duration <= 720:
            raise Blocked("必须明确预约占用时长（1–720分钟），不自动猜测剪染时长")
        services = value["services"]
        if (not isinstance(services, list) or not services
                or any(not isinstance(s, str) or not s.strip() for s in services)
                or len(set(services)) != len(services)):
            raise Blocked("服务项目必须明确且不重复")
        if not isinstance(value["barber"], str) or not value["barber"].strip():
            raise Blocked("必须明确指定发型师")
        return cls(identifier(value["shop_id"]), phone(value["customer_phone"]),
                   value["barber"].strip(), tuple(s.strip() for s in services),
                   instant(value["start"]).isoformat(), duration)

    @property
    def end(self):
        return instant(self.start) + timedelta(minutes=self.duration_minutes)


def select_one(rows, query, shop_id, kind, field="name"):
    candidates = [r for r in rows if r.get("shop_id") == shop_id
                  and r.get("active") is True
                  and (r.get(field) == query or (field == "name" and r.get("id") == query))]
    if len(candidates) != 1:
        raise Blocked(f"{kind}未唯一匹配，需补充或确认，不自动新增/换人/跨店")
    identifier(candidates[0].get("id"))
    return candidates[0]


def validate_snapshot(snapshot, request, now):
    if not isinstance(snapshot, dict) or snapshot.get("complete") is not True:
        raise Blocked("预约数据不完整，不能判定无重复或无冲突")
    if snapshot.get("shop_id") != request.shop_id:
        raise Blocked("门店范围不匹配")
    age = now - observed_time(snapshot.get("fetched_at"))
    if age < timedelta(seconds=-5) or age > MAX_AGE:
        raise Blocked("预约快照过期或时钟异常，须重新只读查询")
    if (instant(snapshot.get("window_start")) > instant(request.start)
            or instant(snapshot.get("window_end")) < request.end):
        raise Blocked("读取范围未覆盖完整服务时段（包括跨午夜预约）")
    for field in ("customers", "barbers", "services", "bookings"):
        rows = snapshot.get(field)
        if not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows):
            raise Blocked("源数据结构不完整")
        keys = []
        for row in rows:
            keys.append(identifier(row.get("id")))
            if row.get("shop_id") != request.shop_id:
                raise Blocked("快照含跨店记录，拒绝混用")
        if len(keys) != len(set(keys)):
            raise Blocked("源数据 ID 重复，需核实分页/身份映射")


@dataclass(frozen=True)
class Plan:
    status: str
    identity: dict
    request_hash: str
    confirmation: str
    expires_at: str
    booking_id: str | None = None
    reason: str = ""

    def public(self):
        value = asdict(self)
        value["identity"] = dict(self.identity)
        number = value["identity"]["customer_phone"]
        value["identity"]["customer_phone"] = number[:3] + "****" + number[-4:]
        return value


def booking_identity(row):
    service_ids = row.get("service_ids")
    if not isinstance(service_ids, list) or not service_ids:
        raise Blocked("预约项目 ID 未核实")
    start = instant(row.get("start"))
    end = instant(row.get("end"))
    if end <= start:
        raise Blocked("预约结束时间异常")
    return dict(shop_id=identifier(row.get("shop_id")),
                customer_id=identifier(row.get("customer_id")),
                customer_phone=phone(row.get("customer_phone")),
                barber_id=identifier(row.get("barber_id")),
                service_ids=sorted(identifier(s) for s in service_ids),
                start=start.isoformat(), end=end.isoformat())


def prepare(request, snapshot, now):
    """Resolve exact identities and detect duplicates before considering a write."""
    validate_snapshot(snapshot, request, now)
    customers = [dict(c, phone=phone(c.get("phone"))) for c in snapshot["customers"]]
    customer = select_one(customers, request.customer_phone,
                          request.shop_id, "顾客", "phone")
    barber = select_one(snapshot["barbers"], request.barber, request.shop_id, "发型师")
    services = [select_one(snapshot["services"], s, request.shop_id, "服务项目")
                for s in request.services]
    service_ids = sorted(identifier(s["id"]) for s in services)
    if len(service_ids) != len(set(service_ids)):
        raise Blocked("不同名称指向同一项目，不能重复选择")
    identity = dict(shop_id=request.shop_id, customer_id=identifier(customer["id"]),
                    customer_phone=request.customer_phone, barber_id=identifier(barber["id"]),
                    service_ids=service_ids, start=request.start, end=request.end.isoformat())
    matches, risks = [], []
    start = instant(request.start)
    for row in snapshot["bookings"]:
        status = row.get("state")
        if status == "cancelled":
            continue
        if status != "active":
            risks.append("源预约状态未核实")
            continue
        row_start = instant(row.get("start"))
        try:
            row_customer = identifier(row.get("customer_id"))
            row_barber = identifier(row.get("barber_id"))
            row_phone = phone(row.get("customer_phone"))
        except Blocked:
            risks.append("源预约顾客或人员身份不完整，无法排除重复/冲突")
            continue
        same_customer = (row_customer == identity["customer_id"] or row_phone == request.customer_phone)
        same_barber = row_barber == identity["barber_id"]
        if same_customer and row_start == start:
            try:
                same = booking_identity(row) == identity
            except Blocked:
                same = False
            if same:
                matches.append(identifier(row["id"]))
            else:
                risks.append("该顾客同一开始时间已有预约，内容不同或无法完整核验")
            continue
        if not (same_customer or same_barber) or row_start >= request.end:
            continue
        if not row.get("end"):
            risks.append("相关预约缺少结束时间，无法排除重叠")
            continue
        row_end = instant(row["end"])
        if row_end <= row_start:
            risks.append("相关预约时间异常")
        elif start < row_end:
            risks.append("顾客或指定发型师的服务时段冲突")
    fingerprint = digest(identity)
    expiry = min(now + MAX_AGE, observed_time(snapshot["fetched_at"]) + MAX_AGE).isoformat()
    confirmation = digest([fingerprint, expiry])
    if len(matches) > 1:
        status, reason = "needs_review", "发现多条相同预约，禁止继续创建"
    elif risks:
        status, reason = "needs_review", "; ".join(sorted(set(risks)))
    elif matches:
        status, reason = "exists", "已存在相同预约，无需创建"
    elif start <= now:
        status, reason = "needs_review", "开始时间已到或已过"
    else:
        status, reason = "ready", "可确认此计划；不代表已经预约"
    return Plan(status, identity, fingerprint, confirmation, expiry,
                matches[0] if len(matches) == 1 else None, reason)


class Journal:
    """One host-local lock + durable intent before the single write attempt.

    Never reset this journal to retry an uncertain transaction. This cannot
    provide atomic exclusion with unrelated browser/Hermes clients.
    """

    def __init__(self, directory):
        self.directory = Path(directory).expanduser()

    @contextmanager
    def locked(self):
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.directory.is_symlink() or self.directory.stat().st_mode & 0o077:
            raise Blocked("预约日志目录必须为当前用户私有（0700）")
        fd = os.open(self.directory / "lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise Blocked("另一个预约操作正在运行，请稍后只读核查") from None
            yield self
        finally:
            os.close(fd)

    def read(self):
        path = self.directory / "journal.json"
        if path.is_symlink():
            raise Blocked("预约日志不允许符号链接")
        if not path.exists():
            return {"schema": 1, "entries": {}}
        if path.is_symlink() or path.stat().st_mode & 0o077:
            raise Blocked("预约日志权限异常")
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise Blocked("预约日志无法读取；不能当作首次请求") from None
        if (not isinstance(value, dict) or value.get("schema") != 1
                or not isinstance(value.get("entries"), dict)):
            raise Blocked("预约日志结构异常")
        for key, row in value["entries"].items():
            if (not isinstance(row, dict) or row.get("state") not in
                    ("pending", "unknown", "confirmed")
                    or not all(k in row for k in ("shop_id", "customer_hash", "barber_id", "start", "end"))):
                raise Blocked("预约日志条目损坏，禁止重试写入")
        return value

    def save(self, value):
        fd, name = tempfile.mkstemp(prefix=".journal-", dir=self.directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as target:
                json.dump(value, target, ensure_ascii=False, sort_keys=True)
                target.flush()
                os.fsync(target.fileno())
            os.replace(name, self.directory / "journal.json")
            dir_fd = os.open(self.directory, os.O_RDONLY)
            try:
                os.fsync(dir_fd)
            finally:
                os.close(dir_fd)
        finally:
            if os.path.exists(name):
                os.unlink(name)


def execute(request, plan, confirmation, gateway, journal, clock):
    """For a future reviewed adapter; currently exercised ONLY by offline tests.

    gateway.snapshot(request): fresh, complete normalized source data.
    gateway.create_once(identity): exactly one request, no network retry.
    gateway.write_verified: True only after the adapter is reviewed against real
    evidence. The supplied CLI has no such adapter or write-enable switch.
    """
    now = clock()
    if confirmation != plan.confirmation or digest([plan.request_hash, plan.expires_at]) != confirmation:
        raise Blocked("确认与具体预约计划不一致")
    if now >= observed_time(plan.expires_at):
        raise Blocked("确认已过期，须重新查询")
    if digest(plan.identity) != plan.request_hash:
        raise Blocked("预约计划被修改")
    with journal.locked():
        fresh = prepare(request, gateway.snapshot(request), clock())
        if fresh.identity != plan.identity:
            raise Blocked("顾客、发型师、项目或时间发生变化，须重新确认")
        state = journal.read()
        entries = state["entries"]
        key = digest([request.shop_id, request.customer_phone, request.start])
        previous = entries.get(key)
        if fresh.status == "exists":
            if previous and (previous.get("request_hash") != plan.request_hash
                             or (previous.get("booking_id") and previous["booking_id"] != fresh.booking_id)
                             or (previous.get("response_id") and previous["response_id"] != fresh.booking_id)):
                raise Blocked("旧尝试与回读预约不一致，需人工核查")
            if previous:
                previous.update(state="confirmed", booking_id=fresh.booking_id)
                journal.save(state)
            return {"status": "exists", "booking_id": fresh.booking_id, "write_attempted": False}
        if previous:
            raise Blocked("已有尝试记录但未回读到相同预约；只可核查，不能再次写入")
        if fresh.status != "ready":
            raise Blocked(fresh.reason)
        customer_hash = digest(request.customer_phone)
        for entry in entries.values():
            if entry["state"] == "confirmed" or entry["shop_id"] != request.shop_id:
                continue
            same_customer_day = (entry["customer_hash"] == customer_hash and
                                 instant(entry["start"]).date() == instant(request.start).date())
            barber_overlap = (entry["barber_id"] == plan.identity["barber_id"] and
                              instant(entry["start"]) < request.end and
                              instant(request.start) < instant(entry["end"]))
            if same_customer_day or barber_overlap:
                raise Blocked("相关预约仍有结果不明的尝试，不能通过改时间/项目绕过")
        if getattr(gateway, "write_verified", False) is not True:
            raise Blocked("真实新增预约接口尚未验证，写入关闭")
        if clock() >= observed_time(plan.expires_at):
            raise Blocked("查询期间确认已过期，未写入")
        entry = dict(state="pending", request_hash=plan.request_hash, shop_id=request.shop_id,
                     customer_hash=customer_hash, barber_id=plan.identity["barber_id"],
                     start=request.start, end=request.end.isoformat())
        entries[key] = entry
        journal.save(state)  # fsync BEFORE network: a crash cannot trigger a blind retry.
        result_id = None
        try:
            result = gateway.create_once(dict(plan.identity))
            result_id = identifier(result.get("booking_id"))
        except Exception:
            pass  # Timeout/HTTP/invalid response: never log raw exception or retry a write.
        if result_id is not None:
            entry["response_id"] = result_id
            journal.save(state)
        try:
            readback = prepare(request, gateway.snapshot(request), clock())
            matched = (readback.status == "exists" and readback.identity == plan.identity
                       and (result_id is None or result_id == readback.booking_id))
        except Exception:
            matched = False
        if matched:
            entry.update(state="confirmed", booking_id=readback.booking_id)
            journal.save(state)
            return {"status": "confirmed_readback", "booking_id": readback.booking_id,
                    "write_attempted": True}
        entry.update(state="unknown")
        journal.save(state)
        raise Blocked("提交结果不明或回读不一致；已阻止重发，只可核查")
