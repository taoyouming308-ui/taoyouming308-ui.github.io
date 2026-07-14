import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from meiguanjia_inventory_connector import AuditJournal, InventoryConnector, WriteCommand, deepseek_advisory
from care_outbound_worker import NeedsReview, WorkerFailure


class FakeClient:
    def __init__(self, result=None):
        self.result = result or {"code": 0, "content": []}
        self.calls = []

    def call(self, action, payload, shop_id):
        self.calls.append((action, payload, shop_id))
        return self.result


class ConnectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.client = FakeClient()
        self.config = {"parent_shop_id": "1103470", "allowed_shop_ids": ["1009951"], "writes_enabled": False, "enabled_write_operations": []}
        self.connector = InventoryConnector(self.config, self.client, AuditJournal(str(pathlib.Path(self.temp.name) / "audit.sqlite3")))

    def tearDown(self):
        self.temp.cleanup()

    def command(self, **updates):
        values = dict(operation="inbound", idempotency_key="stock-task-0001", actor_id="admin-1", actor_role="inventory_admin", shop_id="1009951", items=[{"depot_id": "23043758", "quantity": 2}], approved=True, reason="purchase")
        values.update(updates)
        return WriteCommand(**values)

    def test_read_uses_allowlisted_shop_and_internal_endpoint(self):
        self.connector.read("products", "1009951")
        self.assertEqual(self.client.calls[0][0], "stockApi!getAllDepotList.action")
        self.assertEqual(self.client.calls[0][1]["parentShopId"], "1103470")

    def test_write_is_blocked_before_external_call(self):
        with self.assertRaises(WorkerFailure):
            self.connector.execute(self.command())
        self.assertEqual(self.client.calls, [])
        self.assertEqual(self.connector.journal.exceptions()[0]["error"], "write_capability_disabled")

    def test_permission_and_explicit_approval_are_required(self):
        for command in (self.command(approved=False), self.command(actor_role="viewer")):
            with self.assertRaises(WorkerFailure):
                self.connector.execute(command)
        self.assertEqual(self.client.calls, [])

    def test_depot_id_and_positive_quantity_are_deterministic(self):
        with self.assertRaises(WorkerFailure):
            self.connector.execute(self.command(items=[{"depot_id": "歌薇6A", "quantity": 2}]))
        with self.assertRaises(WorkerFailure):
            self.connector.execute(self.command(items=[{"depot_id": "23043758", "quantity": -2}]))

    def test_same_idempotency_key_with_changed_payload_needs_review(self):
        with self.assertRaises(WorkerFailure):
            self.connector.execute(self.command())
        with self.assertRaises(NeedsReview):
            self.connector.execute(self.command(items=[{"depot_id": "23043758", "quantity": 3}]))

    def test_deepseek_result_is_advisory_only(self):
        result = deepseek_advisory({"商品编号": "depot_id"}, "字段建议")
        self.assertTrue(result["advisory_only"])
        self.assertIn("write_execution", result["prohibited_uses"])


if __name__ == "__main__":
    unittest.main()
