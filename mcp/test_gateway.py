"""隔离测试：不联网、不读真实凭据、不写任何数据。

所有 HTTP 都被替换成假响应；客户/老师/项目全为合成数据。
"""
from __future__ import annotations

import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mgj_gateway as gw  # noqa: E402

DAY = "2026-12-01"
PHONE = "13800000000"
BARBER = "合成老师"

SHOP = dict(gw.SHOPS[0])

METADATA = {
    "code": 0,
    "content": {
        "serviceItems": [
            {"id": 1, "name": "合成剪发", "itemid": "201", "classid": "2", "classname": "剪发"},
            {"id": 2, "name": "合成染发", "itemid": "401", "classid": "4", "classname": "染发"},
            {"id": 3, "name": "预约剪发", "itemid": "2000", "classid": "2", "classname": "剪发"},
        ],
    },
}

CUSTOMER_HTML = (
    '<table><tbody><tr class="memberTr" id="r1"><td>合成客户</td></tr></tbody></table>'
    "checkAllow('100','200','999',"
)

CFG = {"server": "vip12.meiguanjia.net", "cookies": "FAKE_SESSION_FOR_TEST"}


def _list_payload(rows):
    return {"code": 0, "content": {"reservations": rows}}


def _row(**over):
    base = {
        "id": 5001, "status": 0, "reservationTime": gw._ts(DAY, "18:00"),
        "barberId": 777, "barberName": BARBER,
        "memmobile": PHONE, "custName": "合成客户",
        "itemProp": json.dumps({"times": 1, "strategy": 0, "items": {
            "1": {"name": "合成剪发"}, "2": {"name": "合成染发"}}}, ensure_ascii=False),
        "comment": "",
    }
    base.update(over)
    return base


# 合成老师必须"出现在当天预约里"才能被识别（这是真实的取法）
TEACHER_ROW = {
    "id": 1, "status": 0, "reservationTime": gw._ts(DAY, "09:00"),
    "barberId": 777, "barberName": BARBER,
    "memmobile": "13900000001", "custName": "合成占位顾客",
    "itemProp": json.dumps({"items": {"1": {"name": "合成剪发"}}}, ensure_ascii=False),
    "comment": "",
}


class FakeResponse:
    """按 endpoint 返回合成响应，记录调用次数。"""

    def __init__(self, rows=None, create_code=0, create_timeout=False, with_teacher=True):
        if rows is None:
            rows = []
        if with_teacher and not any(r.get("barberId") == 777 for r in rows):
            rows = [TEACHER_ROW] + list(rows)
        self.rows = rows
        self.create_code = create_code
        self.create_timeout = create_timeout
        self.calls = []

    def __call__(self, url, cookie, payload=None, timeout=12.0, as_json=True):
        endpoint = url.rsplit("/shair/", 1)[-1]
        self.calls.append(endpoint)
        if endpoint == "metedata!reservationMetadata.action":
            return METADATA
        if endpoint == "reservation!list.action":
            return _list_payload(self.rows)
        if endpoint == "consumerHelp!find.action":
            return CUSTOMER_HTML
        if endpoint == "reservation!add.action":
            if self.create_timeout:
                raise gw.Blocked("美管加请求失败或超时，已中止且不会重发")
            return {"code": self.create_code, "message": "合成结果"}
        raise AssertionError(f"未预期的接口 {endpoint}")


def count(fake, endpoint):
    return sum(1 for c in fake.calls if c == endpoint)


class ConfigTests(unittest.TestCase):
    def test_rejects_wide_permissions(self):
        with mock.patch.object(gw.Path, "is_file", return_value=True), \
             mock.patch.object(gw.Path, "is_symlink", return_value=False), \
             mock.patch.object(gw.Path, "stat") as st:
            st.return_value.st_mode = 0o644
            with self.assertRaises(gw.Blocked):
                gw.load_config()

    def test_rejects_non_meiguanjia_host(self):
        with self.assertRaises(gw.Blocked):
            gw._base_url({"server": "evil.example.com"})

    def test_prefers_cookies_field(self):
        cfg = {"cookies": "GOOD", "cookie": "STALE"}
        self.assertEqual(gw._cookie(cfg), "GOOD")

    def test_missing_credentials_blocked(self):
        with self.assertRaises(gw.Blocked):
            gw._cookie({})


class ShieldTests(unittest.TestCase):
    def test_phone_masking(self):
        self.assertEqual(gw.mask_phone("13800001234"), "138****1234")

    def test_phone_must_be_complete(self):
        with self.assertRaises(gw.Blocked):
            gw._phone("1380000")

    def test_phone_rejects_non_mobile(self):
        with self.assertRaises(gw.Blocked):
            gw._phone("23800001234")

    def test_name_masking(self):
        self.assertEqual(gw.mask_name("张三丰"), "张**")
        self.assertEqual(gw.mask_name(""), "")

    def test_shop_whitelist(self):
        self.assertEqual(gw.shop_by_ref("自由手艺人")["shopId"], "1009951")
        self.assertEqual(gw.shop_by_ref("1837032")["name"], "向里造型")
        with self.assertRaises(gw.Blocked):
            gw.shop_by_ref("不存在的店")

    def test_expiry_never_defaults_true(self):
        fake = FakeResponse(rows=[])
        fake.__call__ = None  # unused


class CustomerTests(unittest.TestCase):
    def test_unique_customer(self):
        fake = FakeResponse()
        with mock.patch.object(gw, "_request", fake):
            cust = gw.find_customer(SHOP, CFG, PHONE)
        self.assertEqual(cust["custId"], 999)
        self.assertEqual(cust["phone_masked"], "138****0000")

    def test_no_customer_blocks(self):
        fake = FakeResponse()
        with mock.patch.object(gw, "_request", lambda *a, **k: "<html>无结果</html>"):
            with self.assertRaises(gw.Blocked):
                gw.find_customer(SHOP, CFG, PHONE)

    def test_session_expired_page_blocks(self):
        with mock.patch.object(gw, "_request",
                               lambda *a, **k: "<html>请输入验证码</html>"):
            with self.assertRaises(gw.Blocked):
                gw.find_customer(SHOP, CFG, PHONE)

    def test_multiple_candidates_block(self):
        html = "checkAllow('1','2','100', " + "checkAllow('1','2','200', "
        with mock.patch.object(gw, "_request", lambda *a, **k: html):
            with self.assertRaises(gw.Blocked):
                gw.find_customer(SHOP, CFG, PHONE)


class PreflightTests(unittest.TestCase):
    def test_happy_path(self):
        # 同老师同时间不能有别的预约，所以这里用一个空档
        fake = FakeResponse(rows=[])
        with mock.patch.object(gw, "_request", fake):
            res = gw.preflight(SHOP, CFG, DAY, "18:00", BARBER, PHONE,
                               ["合成剪发", "合成染发"])
        self.assertFalse(res["blocked"])
        self.assertEqual([s["name"] for s in res["services"]], ["合成剪发", "合成染发"])
        self.assertEqual(len(res["services"]), 2)
        self.assertEqual(res["plan_id"], res["_plan"]["plan_id"])

    def test_service_separately_selectable(self):
        """剪发/染发必须能分别选择，而不是只能二选一入口项。"""
        fake = FakeResponse(rows=[])
        with mock.patch.object(gw, "_request", fake):
            only_cut = gw.preflight(SHOP, CFG, DAY, "18:00", BARBER, PHONE, ["合成剪发"])
            only_dye = gw.preflight(SHOP, CFG, DAY, "18:00", BARBER, PHONE, ["合成染发"])
            both = gw.preflight(SHOP, CFG, DAY, "18:00", BARBER, PHONE,
                                ["合成剪发", "合成染发"])
        self.assertEqual([s["name"] for s in only_cut["services"]], ["合成剪发"])
        self.assertEqual([s["name"] for s in only_dye["services"]], ["合成染发"])
        self.assertEqual(len(both["services"]), 2)
        self.assertNotEqual(only_cut["plan_id"], only_dye["plan_id"])

    def test_unknown_service_blocks(self):
        fake = FakeResponse(rows=[])
        with mock.patch.object(gw, "_request", fake):
            with self.assertRaises(gw.Blocked):
                gw.preflight(SHOP, CFG, DAY, "18:00", BARBER, PHONE, ["不存在的项目"])

    def test_unknown_barber_blocks(self):
        fake = FakeResponse(rows=[])
        with mock.patch.object(gw, "_request", fake):
            with self.assertRaises(gw.Blocked):
                gw.preflight(SHOP, CFG, DAY, "18:00", "查无此人", PHONE, ["合成剪发"])

    def test_existing_same_slot_blocks(self):
        """同客户同时间已有预约时必须 block，不能创建重复单。"""
        fake = FakeResponse(rows=[_row()])
        with mock.patch.object(gw, "_request", fake):
            res = gw.preflight(SHOP, CFG, DAY, "18:00", BARBER, PHONE, ["合成剪发"])
        self.assertTrue(res["blocked"])
        self.assertEqual(res["duplicate_same_time"][0]["id"], 5001)

    def test_barber_slot_taken_blocks(self):
        other = _row(id=2, memmobile="13900000000")
        fake = FakeResponse(rows=[other])
        with mock.patch.object(gw, "_request", fake):
            res = gw.preflight(SHOP, CFG, DAY, "18:00", BARBER, PHONE, ["合成剪发"])
        self.assertTrue(res["blocked"])
        self.assertEqual(res["barber_slot_taken"][0]["id"], 2)

    def test_cancelled_row_does_not_block(self):
        cancelled = _row(id=3, memmobile="13900000000", status=2)
        fake = FakeResponse(rows=[cancelled])
        with mock.patch.object(gw, "_request", fake):
            res = gw.preflight(SHOP, CFG, DAY, "18:00", BARBER, PHONE, ["合成剪发"])
        self.assertFalse(res["blocked"])

    def test_no_secret_in_plan_output(self):
        fake = FakeResponse(rows=[])
        with mock.patch.object(gw, "_request", fake):
            res = gw.preflight(SHOP, CFG, DAY, "18:00", BARBER, PHONE, ["合成剪发"])
        public = {k: v for k, v in res.items() if k != "_plan"}
        blob = json.dumps(public, ensure_ascii=False)
        self.assertNotIn(CFG["cookies"], blob)
        self.assertNotIn(PHONE, blob)
        self.assertNotIn("合成客户", blob)


class ItemPropTests(unittest.TestCase):
    def test_full_item_prop_structure(self):
        services = [{"id": 1, "name": "合成剪发", "itemid": "201", "classid": "2"},
                    {"id": 2, "name": "合成染发", "itemid": "401", "classid": "4"}]
        prop = json.loads(gw.build_item_prop(services, SHOP))
        self.assertEqual(prop["times"], 1)
        self.assertEqual(prop["strategy"], 0)
        self.assertEqual(set(prop["items"]), {"1", "2"})
        item = prop["items"]["1"]
        for field in ("id", "name", "itemid", "classid", "sorting", "price",
                      "adjustPrice", "shopids", "stopshopids", "item_description",
                      "mgjservicesetlogo", "userLevels", "time", "priceFlag",
                      "reserv", "timeStr"):
            self.assertIn(field, item)
        self.assertEqual(item["shopids"], ",1009951,")
        self.assertEqual(item["price"], 0)

    def test_payload_shape(self):
        plan = {
            "shop": SHOP, "date": DAY, "time_ms": gw._ts(DAY, "18:00"),
            "barber_name": BARBER, "barber_id": 777,
            "customer": {"custId": 999, "custName": "合成客户", "phone": PHONE},
            "services": [{"id": 1, "name": "合成剪发", "itemid": "201", "classid": "2"}],
        }
        body = gw.build_payload(plan, "合成备注")
        for field in ("parentShopId", "shopId", "custId", "custName", "memmobile",
                      "reservationTime", "itemProp", "barberId", "barberName",
                      "number", "comment", "channel", "reservationType", "type"):
            self.assertIn(field, body)
        self.assertEqual(body["number"], 1)
        self.assertEqual(body["channel"], 0)
        self.assertEqual(body["comment"], "合成备注")
        self.assertIsInstance(body["itemProp"], str)


class CreateTests(unittest.TestCase):
    def _plan(self):
        return {
            "shop": SHOP, "date": DAY, "time_ms": gw._ts(DAY, "18:00"),
            "barber_name": BARBER, "barber_id": 777,
            "customer": {"custId": 999, "custName": "合成客户", "phone": PHONE},
            "services": [{"id": 1, "name": "合成剪发", "itemid": "201", "classid": "2"}],
        }

    def test_success_maps_to_accepted(self):
        fake = FakeResponse(create_code=0)
        with mock.patch.object(gw, "_request", fake):
            out = gw.create_once(self._plan(), CFG)
        self.assertEqual(out["outcome"], "accepted")
        self.assertEqual(count(fake, "reservation!add.action"), 1)

    def test_conflict_code(self):
        fake = FakeResponse(create_code=1012)
        with mock.patch.object(gw, "_request", fake):
            out = gw.create_once(self._plan(), CFG)
        self.assertEqual(out["outcome"], "conflict")

    def test_no_member_code(self):
        fake = FakeResponse(create_code=2003)
        with mock.patch.object(gw, "_request", fake):
            out = gw.create_once(self._plan(), CFG)
        self.assertEqual(out["outcome"], "no_member")

    def test_unknown_code_is_not_success(self):
        fake = FakeResponse(create_code=500)
        with mock.patch.object(gw, "_request", fake):
            out = gw.create_once(self._plan(), CFG)
        self.assertEqual(out["outcome"], "unknown")

    def test_timeout_does_not_retry(self):
        """超时只能发一次，绝不重发。"""
        fake = FakeResponse(create_timeout=True)
        with mock.patch.object(gw, "_request", fake):
            with self.assertRaises(gw.Blocked):
                gw.create_once(self._plan(), CFG)
        self.assertEqual(count(fake, "reservation!add.action"), 1)


class ReadbackTests(unittest.TestCase):
    def _plan(self):
        return {
            "shop": SHOP, "date": DAY, "time_ms": gw._ts(DAY, "18:00"),
            "barber_name": BARBER, "barber_id": 777,
            "customer": {"custId": 999, "custName": "合成客户", "phone": PHONE},
            "services": [{"id": 1, "name": "合成剪发"}, {"id": 2, "name": "合成染发"}],
        }

    def test_full_match_verifies(self):
        fake = FakeResponse(rows=[_row()])
        with mock.patch.object(gw, "_request", fake):
            out = gw.readback(self._plan(), CFG)
        self.assertTrue(out["verified"])
        self.assertEqual(out["booking_id"], 5001)

    def test_missing_readback_not_verified(self):
        fake = FakeResponse(rows=[])
        with mock.patch.object(gw, "_request", fake):
            out = gw.readback(self._plan(), CFG)
        self.assertFalse(out["verified"])
        self.assertIn("禁止自动重发", out["reason"])

    def test_service_mismatch_not_verified(self):
        row = _row(itemProp=json.dumps({"items": {"1": {"name": "合成剪发"}}}))
        fake = FakeResponse(rows=[row])
        with mock.patch.object(gw, "_request", fake):
            out = gw.readback(self._plan(), CFG)
        self.assertFalse(out["verified"])
        self.assertIn("项目不一致", out["reason"])

    def test_wrong_barber_not_matched(self):
        fake = FakeResponse(rows=[_row(barberId=888)])
        with mock.patch.object(gw, "_request", fake):
            out = gw.readback(self._plan(), CFG)
        self.assertFalse(out["verified"])

    def test_duplicate_rows_need_review(self):
        fake = FakeResponse(rows=[_row(id=5001), _row(id=5002)])
        with mock.patch.object(gw, "_request", fake):
            out = gw.readback(self._plan(), CFG)
        self.assertFalse(out["verified"])
        self.assertIn("多条", out["reason"])

    def test_cancelled_row_not_verified(self):
        fake = FakeResponse(rows=[_row(status=2)])
        with mock.patch.object(gw, "_request", fake):
            out = gw.readback(self._plan(), CFG)
        self.assertFalse(out["verified"])


class NoWriteLeakTests(unittest.TestCase):
    def test_readback_only_touches_list_endpoint(self):
        fake = FakeResponse(rows=[_row()])
        plan = {
            "shop": SHOP, "date": DAY, "time_ms": gw._ts(DAY, "18:00"),
            "barber_name": BARBER, "barber_id": 777,
            "customer": {"custId": 999, "custName": "合成客户", "phone": PHONE},
            "services": [{"id": 1, "name": "合成剪发"}, {"id": 2, "name": "合成染发"}],
        }
        with mock.patch.object(gw, "_request", fake):
            gw.readback(plan, CFG)
        self.assertEqual(count(fake, "reservation!add.action"), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
