import importlib.util
import pathlib
import tempfile
import unittest


SCRIPT_PATH = pathlib.Path(__file__).with_name("mgj_keepalive.py")
SPEC = importlib.util.spec_from_file_location("mgj_keepalive", SCRIPT_PATH)
KEEPALIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(KEEPALIVE)


class KeepaliveTests(unittest.TestCase):
    def test_atomic_json_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "status.json"
            KEEPALIVE.atomic_write_json(str(path), {"status": "healthy"})
            self.assertEqual(KEEPALIVE.load_json(str(path)), {"status": "healthy"})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_save_session_preserves_existing_config(self):
        original_path = KEEPALIVE.CONFIG_PATH
        with tempfile.TemporaryDirectory() as directory:
            KEEPALIVE.CONFIG_PATH = str(pathlib.Path(directory) / "config.json")
            try:
                KEEPALIVE.save_session(
                    {"server": "vip12.meiguanjia.net", "shop_id": "1009951"},
                    "JSESSIONID=test",
                    "keepalive_verified",
                )
                saved = KEEPALIVE.load_json(KEEPALIVE.CONFIG_PATH)
                self.assertEqual(saved["shop_id"], "1009951")
                self.assertEqual(saved["cookies"], "JSESSIONID=test")
                self.assertEqual(saved["cookie_source"], "keepalive_verified")
            finally:
                KEEPALIVE.CONFIG_PATH = original_path


if __name__ == "__main__":
    unittest.main()
