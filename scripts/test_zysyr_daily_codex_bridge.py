import os
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
import zysyr_daily_codex_bridge as bridge


def subprocess_result(*, stdout="", returncode=0):
    return type("Completed", (), {"stdout": stdout, "stderr": b"", "returncode": returncode})()


class Headers(dict):
    def get(self, key, default=None):
        return super().get(key, default)


class Handler:
    def __init__(self, authorization=""):
        self.headers = Headers(Authorization=authorization)
        self.sent = None

    def send_json(self, payload, status=200):
        self.sent = (payload, status)


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
        self.assertIn("rows", schema["required"])
        self.assertIn("numeric_value", schema["properties"]["cells"]["items"]["properties"])
        self.assertIn("text_value", schema["properties"]["cells"]["items"]["properties"])

    def test_cell_positions_are_preserved_for_paper_mapping(self):
        cells = bridge._clean_cells([{
            "id": "00000000-0000-0000-0000-000000000001",
            "section": "stylist", "row": "stylist_1", "name": "第1行",
            "column": "烫染", "role": "staff_value", "row_number": 3,
            "column_number": 4,
        }])
        self.assertEqual(cells[0]["row_number"], 3)
        self.assertEqual(cells[0]["column_number"], 4)
        prompt = bridge._prompt("自由手艺人", "2026-01-03", cells)
        self.assertIn("姓名栏", prompt)
        self.assertIn("未结单号", prompt)
        self.assertIn("空白仍为空白", prompt)
        self.assertIn("同一条横向网格线", prompt)
        self.assertIn('"row_number":3', prompt)

    def test_image_pixels_are_auto_oriented_before_section_crops(self):
        commands = []

        def fake_run(command, **kwargs):
            commands.append(command)
            if "identify" in command:
                return subprocess_result(stdout="4000 5000", returncode=0)
            Path(command[-1]).touch()
            return subprocess_result(returncode=0)

        with tempfile.TemporaryDirectory() as work, mock.patch.object(bridge.subprocess, "run", side_effect=fake_run):
            source = Path(work) / "source.jpg"
            source.touch()
            images = bridge._prepare_images(source, Path(work))
        self.assertEqual(set(images), {"stylist", "technician", "lower"})
        self.assertEqual(len(images["stylist"]), 2)
        self.assertIn("-auto-orient", commands[0])
        self.assertEqual(commands[0][commands[0].index("+set") + 1], "orientation")
        self.assertNotIn("-rotate", commands[0])

    def test_recognition_parallelism_is_bounded(self):
        acquired = []
        try:
            for _ in range(bridge._MAX_PARALLEL_RECOGNITIONS):
                acquired.append(bridge._RECOGNITION_SLOT.acquire(blocking=False))
            self.assertTrue(all(acquired))
            self.assertFalse(bridge._RECOGNITION_SLOT.acquire(blocking=False))
        finally:
            for success in acquired:
                if success:
                    bridge._RECOGNITION_SLOT.release()

    def test_health_requires_auth_and_never_reports_secrets_or_runs_codex(self):
        previous = os.environ.get("ZYSYR_DAILY_CODEX_TOKEN")
        os.environ["ZYSYR_DAILY_CODEX_TOKEN"] = "health-test-secret"
        try:
            denied = Handler()
            bridge.handle_daily_codex_health(denied)
            self.assertEqual(denied.sent, ({"error": "unauthorized"}, 401))

            allowed = Handler("Bearer health-test-secret")
            with mock.patch.object(bridge.shutil, "which", return_value="/fake/codex"), \
                 mock.patch.object(bridge.os.path, "isfile", return_value=True), \
                 mock.patch.object(bridge.os, "access", return_value=True), \
                 mock.patch.object(bridge.subprocess, "run", side_effect=AssertionError("health must not execute Codex")):
                bridge.handle_daily_codex_health(allowed)
            payload, status = allowed.sent
            self.assertEqual(status, 200)
            self.assertEqual(payload, {"status": "reachable", "codex_cli": "available",
                                       "codex_login": "not_checked", "candidate_only": True})
            self.assertNotIn("health-test-secret", json.dumps(payload))

            degraded = Handler("Bearer health-test-secret")
            with mock.patch.object(bridge.shutil, "which", return_value="/fake/codex"), \
                 mock.patch.object(bridge.os.path, "isfile", return_value=False), \
                 mock.patch.object(bridge.os, "access", return_value=False):
                bridge.handle_daily_codex_health(degraded)
            self.assertEqual(degraded.sent[1], 503)
            self.assertEqual(degraded.sent[0]["status"], "degraded")
        finally:
            if previous is None:
                os.environ.pop("ZYSYR_DAILY_CODEX_TOKEN", None)
            else:
                os.environ["ZYSYR_DAILY_CODEX_TOKEN"] = previous

    def test_overlapping_crop_duplicates_keep_highest_confidence_candidate(self):
        numeric_id = "00000000-0000-0000-0000-000000000001"
        text_id = "00000000-0000-0000-0000-000000000002"
        cells = bridge._clean_cells([
            {"id": numeric_id, "section": "stylist", "row": "stylist_1", "name": "第1行",
             "column": "烫染", "role": "staff_value", "row_number": 3, "column_number": 4},
            {"id": text_id, "section": "other", "row": "note", "name": "备注",
             "column": "备注", "role": "note", "row_number": 34, "column_number": 1},
        ])
        parsed = {"cells": [
            {"id": numeric_id, "numeric_value": 128, "text_value": None, "confidence": 0.61, "note": "上部"},
            {"id": numeric_id, "numeric_value": 123, "text_value": None, "confidence": 0.94, "note": "中部"},
            {"id": text_id, "numeric_value": None, "text_value": "核对", "confidence": 0.82, "note": "下部"},
            {"id": text_id, "numeric_value": None, "text_value": "模糊", "confidence": 0.32, "note": "重叠"},
        ], "rows": []}
        numeric, text, rows = bridge._normalize_recognition_output(parsed, cells)
        self.assertEqual(numeric, [{"id": numeric_id, "value": 123.0, "confidence": 0.94, "note": "中部"}])
        self.assertEqual(text, [{"id": text_id, "value": "核对", "confidence": 0.82, "note": "下部"}])
        self.assertEqual(rows, [])


if __name__ == "__main__":
    unittest.main()
