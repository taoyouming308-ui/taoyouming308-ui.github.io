import importlib.util
import pathlib
import unittest
from unittest import mock


SCRIPT = pathlib.Path(__file__).with_name("update_customer_plan_tunnel_url.py")
SPEC = importlib.util.spec_from_file_location("update_customer_plan_tunnel_url", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CustomerPlanTunnelTests(unittest.TestCase):
    def test_uses_most_recent_quick_tunnel_url(self):
        text = "old https://first-example.trycloudflare.com new https://second-example.trycloudflare.com"
        self.assertEqual(MODULE.latest_tunnel_base(text), "https://second-example.trycloudflare.com")

    def test_missing_url_is_not_healthy(self):
        self.assertFalse(MODULE.endpoint_responds(""))

    def test_expected_missing_phone_response_is_healthy(self):
        error = MODULE.urllib.error.HTTPError("https://example.test", 400, "bad request", {}, None)
        with mock.patch.object(MODULE.urllib.request, "urlopen", side_effect=error):
            self.assertTrue(MODULE.endpoint_responds("https://example.test"))


if __name__ == "__main__":
    unittest.main()
