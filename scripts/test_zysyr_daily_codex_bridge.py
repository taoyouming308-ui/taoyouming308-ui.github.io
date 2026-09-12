import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
import zysyr_daily_codex_bridge as bridge


class Headers(dict):
    def get(self, key, default=None):
        return super().get(key, default)


class Handler:
    def __init__(self, authorization=""):
        self.headers = Headers(Authorization=authorization)


class DailyCodexBridgeTests(unittest.TestCase):
    def test_bearer_token_is_required_and_compared(self):
        previous = os.environ.get("ZYSYR_DAILY_CODEX_TOKEN")
        os.environ["ZYSYR_DAILY_CODEX_TOKEN"] = "expected-token"
        try:
            self.assertFalse(bridge._authorized(Handler()))
            self.assertFalse(bridge._authorized(Handler("Bearer wrong")))
            self.assertTrue(bridge._authorized(Handler("Bearer expected-token")))
        finally:
            if previous is None:
                os.environ.pop("ZYSYR_DAILY_CODEX_TOKEN", None)
            else:
                os.environ["ZYSYR_DAILY_CODEX_TOKEN"] = previous

    def test_duplicate_cell_ids_are_rejected(self):
        cell = {"id": "00000000-0000-0000-0000-000000000001"}
        with self.assertRaisesRegex(ValueError, "编号无效"):
            bridge._clean_cells([cell, cell])

    def test_output_schema_rejects_extra_fields(self):
        schema = bridge._schema()
        self.assertFalse(schema["additionalProperties"])
        self.assertFalse(schema["properties"]["cells"]["items"]["additionalProperties"])

    def test_recognition_is_limited_to_one_local_codex_process(self):
        self.assertTrue(bridge._RECOGNITION_SLOT.acquire(blocking=False))
        try:
            self.assertFalse(bridge._RECOGNITION_SLOT.acquire(blocking=False))
        finally:
            bridge._RECOGNITION_SLOT.release()


if __name__ == "__main__":
    unittest.main()
