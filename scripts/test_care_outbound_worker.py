import importlib.util
import pathlib
import sys
import unittest


SCRIPT_PATH = pathlib.Path(__file__).with_name("care_outbound_worker.py")
SPEC = importlib.util.spec_from_file_location("care_outbound_worker", SCRIPT_PATH)
worker_module = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = worker_module
SPEC.loader.exec_module(worker_module)


class FakeSupabase:
    def __init__(self, queue_rows=None, hair_rows=None):
        self.queue_rows = queue_rows or []
        self.hair_rows = hair_rows or []
        self.status_updates = []
        self.claimed = []

    def fetch_candidates(self):
        return self.queue_rows

    def fetch_hair_rows(self):
        return self.hair_rows

    def claim_many(self, queue_ids):
        self.claimed.extend(queue_ids)
        return True

    def set_status(self, queue_ids, status, message=None):
        self.status_updates.append((tuple(queue_ids), status, message))


class FakeStock:
    def __init__(self, document=None):
        self.document = document
        self.created = []
        self.audited = []

    def find_document(self, shop_id, queued_at, remark):
        return self.document

    def create_document(self, shop_id, remark, details):
        self.created.append((shop_id, remark, details))
        self.document = {
            "id": "73599999",
            "billno": "CPKYTEST001",
            "status": "0",
            "outwaretype": "8",
            "remark": remark,
            "operatName": "陶友明",
            "details": [
                {"depotid": item["depotid"], "num": item["num"]}
                for item in details
            ],
        }

    def audit_document(self, shop_id, document):
        self.audited.append((shop_id, document["id"]))
        self.document["status"] = "1"


class RecordingMeiguanjiaClient(worker_module.MeiguanjiaStockClient):
    def __init__(self):
        super().__init__(
            server="example.invalid",
            cookies="userId=543987; token=test-token",
            parent_shop_id="1103470",
            sleep_fn=lambda _: None,
        )
        self._operator_info = ("543987", "陶友明", "1009951")
        self.calls = []

    def call(self, action, payload, shop_id):
        self.calls.append((action, payload, shop_id))
        return {"code": 0, "message": "success"}


def make_batch():
    return {
        "protocolVersion": 2,
        "batchKey": "FC-100",
        "hairRecordId": "hair-1",
        "shopName": "自由手艺人",
        "barber": "无名",
        "queuedAt": "2026-07-01T02:00:00.000Z",
        "items": [
            {
                "queueId": -101,
                "brand": "歌薇酸性护理",
                "product": "6A",
                "grams": 15,
            },
            {
                "queueId": -102,
                "brand": "欧拉裴",
                "product": "1号",
                "grams": 3,
            },
        ],
    }


def make_store_config(runtime_enabled=False):
    return {
        "runtime_enabled": runtime_enabled,
        "shops": {
            "自由手艺人": {
                "enabled": True,
                "shop_id": "1009951",
                "products": {
                    "歌薇酸性护理": {"6A": "23043758"},
                    "欧拉裴": {"1号": "23043813"},
                },
            },
            "向里造型": {
                "enabled": False,
                "shop_id": "1837032",
                "products": {},
            },
        },
    }


class CareOutboundWorkerTests(unittest.TestCase):
    def test_meiguanjia_payload_uses_current_outdepot_details_contract(self):
        client = RecordingMeiguanjiaClient()
        details = [
            {
                "id": None,
                "depotid": "23043758",
                "num": 1,
                "price": 0,
                "remark": None,
                "depotName": "歌薇酸性护理6A",
            }
        ]
        client.create_document("1009951", "护理App|TEST", details)
        action, payload, shop_id = client.calls[0]
        self.assertEqual(action, "stockApi!saveOutDepot.action")
        self.assertEqual(shop_id, "1009951")
        self.assertEqual(payload["shopId"], "1009951")
        self.assertEqual(payload["outdepot"]["outwaretype"], "8")
        self.assertEqual(payload["outdepot"]["details"], details)
        self.assertEqual(payload["outdepot"]["totoalNum"], 1)
        self.assertNotIn("stockOutDepotDetailDtoList", payload)

        client.audit_document(
            "1009951",
            {
                "id": "73539957",
                "status": "0",
                "outwaretype": "8",
                "operatName": "陶友明",
            },
        )
        audit_action, audit_payload, _ = client.calls[1]
        self.assertEqual(audit_action, "stockApi!auditOutDepot.action")
        self.assertEqual(audit_payload["outdepot"]["id"], "73539957")
        self.assertEqual(audit_payload["outdepot"]["type"], -1)
        self.assertEqual(audit_payload["outdepot"]["status"], 0)

    def test_builds_context_only_for_protocol_v2_negative_ids(self):
        rows = [
            {
                "id": "hair-1",
                "barber": "无名",
                "record_data": {
                    "careOutboundPending": make_batch(),
                    "careOutboundBatches": [
                        {
                            "protocolVersion": 1,
                            "items": [{"queueId": 55, "grams": 10}],
                        }
                    ],
                },
            }
        ]
        contexts = worker_module.build_context_map(rows)
        self.assertEqual(set(contexts), {-101, -102})
        self.assertEqual(contexts[-101].shop_name, "自由手艺人")

    def test_document_match_uses_exact_depot_gram_totals(self):
        document = {
            "details": [
                {"depotid": "23043758", "num": 10},
                {"depotid": "23043758", "num": 5},
                {"depotid": "23043813", "num": 3},
            ]
        }
        expected = [
            {"depotid": "23043758", "num": 15},
            {"depotid": "23043813", "num": 3},
        ]
        self.assertTrue(worker_module.document_matches(document, expected))
        expected[0]["num"] = 14
        self.assertFalse(worker_module.document_matches(document, expected))

    def test_create_audit_verify_then_complete(self):
        batch = make_batch()
        hair_rows = [
            {
                "id": "hair-1",
                "barber": "无名",
                "record_data": {"careOutboundPending": batch},
            }
        ]
        queue_rows = [
            {
                "id": item["queueId"],
                "brand": item["brand"],
                "product": item["product"],
                "grams": item["grams"],
                "status": "pending",
                "created_at": batch["queuedAt"],
            }
            for item in batch["items"]
        ]
        supabase = FakeSupabase(queue_rows, hair_rows)
        stock = FakeStock()
        worker = worker_module.CareOutboundWorker(
            make_store_config(), supabase, stock, logger=lambda _: None
        )
        self.assertEqual(worker.run(), 0)
        self.assertEqual(set(supabase.claimed), {-101, -102})
        self.assertEqual(stock.created[0][0], "1009951")
        self.assertEqual(stock.created[0][1], "护理App|FC-100")
        self.assertEqual(stock.audited, [("1009951", "73599999")])
        self.assertEqual(supabase.status_updates[-1][1], "completed")
        self.assertIn("CPKYTEST001", supabase.status_updates[-1][2])

    def test_existing_audited_document_is_not_created_again(self):
        batch = make_batch()
        details = [
            {"depotid": "23043758", "num": 15},
            {"depotid": "23043813", "num": 3},
        ]
        existing = {
            "id": "73599999",
            "billno": "CPKYTEST002",
            "status": "1",
            "outwaretype": "8",
            "remark": "护理App|FC-100",
            "details": details,
        }
        queue_rows = [
            {
                "id": item["queueId"],
                "brand": item["brand"],
                "product": item["product"],
                "grams": item["grams"],
                "status": "processing",
                "created_at": batch["queuedAt"],
            }
            for item in batch["items"]
        ]
        supabase = FakeSupabase(
            queue_rows,
            [{"id": "hair-1", "record_data": {"careOutboundBatches": [batch]}}],
        )
        stock = FakeStock(existing)
        worker = worker_module.CareOutboundWorker(
            make_store_config(), supabase, stock, logger=lambda _: None
        )
        self.assertEqual(worker.run(), 0)
        self.assertEqual(stock.created, [])
        self.assertEqual(stock.audited, [])
        self.assertEqual(supabase.status_updates[-1][1], "completed")

    def test_xiangli_is_rejected_before_external_write(self):
        batch = make_batch()
        batch["shopName"] = "向里造型"
        queue_rows = [
            {
                "id": -101,
                "brand": "歌薇酸性护理",
                "product": "6A",
                "grams": 15,
                "status": "pending",
                "created_at": batch["queuedAt"],
            }
        ]
        batch["items"] = [batch["items"][0]]
        supabase = FakeSupabase(
            queue_rows,
            [{"id": "hair-1", "record_data": {"careOutboundPending": batch}}],
        )
        stock = FakeStock()
        worker = worker_module.CareOutboundWorker(
            make_store_config(), supabase, stock, logger=lambda _: None
        )
        self.assertEqual(worker.run(), 1)
        self.assertEqual(stock.created, [])
        self.assertEqual(supabase.status_updates[-1][1], "failed")


if __name__ == "__main__":
    unittest.main()
