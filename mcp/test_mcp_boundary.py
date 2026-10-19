"""Synthetic tool-boundary tests; SDK stub only, no live protocol claim."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import mgj_gateway as gw
from test_gateway import BARBER, CFG, DAY, PHONE, FakeResponse


class FakeServer:
    def __init__(self, **kwargs):
        pass

    def tool(self, **kwargs):
        return lambda func: func


def load_server():
    sdk = types.ModuleType("mcp.server.mcpserver")
    sdk.MCPServer = FakeServer
    name = "synthetic_mgj_tool_boundary"
    spec = importlib.util.spec_from_file_location(
        name, Path(__file__).with_name("mgj_booking_mcp.py"))
    module = importlib.util.module_from_spec(spec)
    with mock.patch.dict(sys.modules, {"mcp.server.mcpserver": sdk}):
        spec.loader.exec_module(module)
    return module


class ToolBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.network = mock.patch("socket.socket", side_effect=AssertionError("network forbidden"))
        self.network.start()
        self.addCleanup(self.network.stop)
        self.server = load_server()

    def preflight(self):
        with mock.patch.object(gw, "load_config", return_value=CFG), \
                mock.patch.object(gw, "_request", FakeResponse()):
            return self.server.mgj_booking_preflight(
                "1009951", DAY, "18:00", BARBER, PHONE, ["合成剪发"])

    def test_env_cannot_enable_writes_even_with_a_real_plan(self):
        with mock.patch.dict(os.environ, {"MGJ_MCP_ALLOW_WRITE": "1"}):
            self.server = load_server()
            result = self.preflight()
            with mock.patch.object(gw, "create_once") as create:
                for _ in range(2):
                    with self.assertRaises(gw.Blocked):
                        self.server.mgj_booking_confirm(result["plan_id"])
                create.assert_not_called()

    def test_restart_cannot_turn_an_old_plan_into_a_write(self):
        result = self.preflight()
        restarted = load_server()
        with mock.patch.object(gw, "create_once") as create:
            with self.assertRaises(gw.Blocked):
                restarted.mgj_booking_confirm(result["plan_id"])
            create.assert_not_called()

    def test_public_plan_is_masked_and_incomplete(self):
        result = self.preflight()
        self.assertNotIn(PHONE, json.dumps(result))
        self.assertNotIn("_plan", result)
        self.assertTrue(result["blocked"])
        self.assertFalse(result["conflict_check_complete"])

    def test_health_calls_source_and_cannot_claim_an_expired_session(self):
        with mock.patch.object(gw, "load_config", return_value=CFG), \
                mock.patch.object(gw, "_request", return_value={"code": 3}):
            with self.assertRaises(gw.Blocked):
                self.server.mgj_health()

    def test_health_does_not_report_env_as_effective_write_permission(self):
        with mock.patch.object(gw, "load_config", return_value=CFG), \
                mock.patch.object(gw, "_request", FakeResponse()), \
                mock.patch.dict(os.environ, {"MGJ_MCP_ALLOW_WRITE": "1"}):
            result = self.server.mgj_health()
        self.assertTrue(result["session_valid"])
        self.assertFalse(result["write_enabled"])

    def test_readonly_plan_expires(self):
        with mock.patch.object(self.server.clock, "monotonic", return_value=1000):
            result = self.preflight()
        with mock.patch.object(self.server.clock, "monotonic", return_value=1301):
            with self.assertRaises(gw.Blocked):
                self.server.mgj_booking_readback(result["plan_id"])
        self.assertFalse(self.server._PLANS)

    def test_cache_is_bounded(self):
        with mock.patch.object(self.server, "MAX_PLANS", 2):
            ids = [self.preflight()["plan_id"] for _ in range(3)]
        self.assertEqual(len(self.server._PLANS), 2)
        self.assertNotIn(ids[0], self.server._PLANS)


if __name__ == "__main__":
    unittest.main()
