import io
import json
import base64
import urllib.error
import unittest
from unittest import mock

import scripts.aesthetic_coach_endpoint as coach


class FakeHandler:
    def __init__(self, payload, origin="https://taoyouming308-ui.github.io"):
        raw = json.dumps(payload).encode("utf-8")
        self.headers = {"Content-Length": str(len(raw)), "Origin": origin}
        self.rfile = io.BytesIO(raw)
        self.client_address = ("127.0.0.1", 12345)
        self.result = None

    def send_json(self, data, status=200):
        self.result = (status, data)


def valid_payload():
    return {
        "username": "测试发型师",
        "store": "自由手艺人",
        "stage": "observe",
        "answer": "整体轮廓偏圆，重量集中在耳上和后脑，后颈有较轻的延伸和外翻。",
        "previous_answers": {},
        "case": {
            "id": "CASE-001",
            "title": "轻盈短发",
            "category": "短发",
            "focus": "轮廓",
            "image_url": "https://taoyouming308-ui.github.io/img/showcase.jpg",
            "limitations": "只有侧面",
            "reference": "圆形轮廓",
        },
    }


def active_staff(_path):
    return [{"username": "测试发型师", "store": "自由手艺人", "active": True}]


class AestheticCoachEndpointTests(unittest.TestCase):
    def setUp(self):
        coach._RATE_STATE.clear()

    def test_rejects_untrusted_origin(self):
        handler = FakeHandler(valid_payload(), "https://evil.example")
        coach.handle_aesthetic_coach(handler, "key", active_staff)
        self.assertEqual(handler.result[0], 403)

    def test_rejects_external_image(self):
        payload = valid_payload()
        payload["case"]["image_url"] = "https://example.com/image.jpg"
        handler = FakeHandler(payload)
        coach.handle_aesthetic_coach(handler, "key", active_staff)
        self.assertEqual(handler.result[0], 400)

    def test_rejects_inactive_employee(self):
        handler = FakeHandler(valid_payload())
        coach.handle_aesthetic_coach(handler, "key", lambda _path: [])
        self.assertEqual(handler.result[0], 403)

    def test_returns_normalized_model_feedback(self):
        handler = FakeHandler(valid_payload())
        feedback = {
            "score": 82,
            "affirmation": "你准确指出了重量位置。",
            "omissions": ["补充刘海和脸周", "区分事实与推测"],
            "follow_up": "外轮廓在哪里开始转轻？",
            "ready": True,
            "model": coach.MODEL,
        }
        with mock.patch.object(coach, "_call_openrouter", return_value=feedback):
            coach.handle_aesthetic_coach(handler, "key", active_staff)
        self.assertEqual(handler.result[0], 200)
        self.assertEqual(handler.result[1]["score"], 82)

    def test_blocks_low_quality_answer_without_calling_model(self):
        payload = valid_payload()
        payload["answer"] = "asdfasdfasdfasdf"
        handler = FakeHandler(payload)
        with mock.patch.object(coach, "_call_openrouter") as mocked:
            coach.handle_aesthetic_coach(handler, "key", active_staff)
            mocked.assert_not_called()
        self.assertEqual(handler.result[0], 200)
        self.assertLessEqual(handler.result[1]["score"], 20)
        self.assertFalse(handler.result[1]["ready"])

    def test_blocks_repeated_chinese_gibberish_without_calling_model(self):
        payload = valid_payload()
        payload["answer"] = "就斤斤计较斤斤计较及坎坎坷坷健健康康坎坎坷坷看坎坎坷坷门密密麻麻姐姐"
        handler = FakeHandler(payload)
        with mock.patch.object(coach, "_call_openrouter") as mocked:
            coach.handle_aesthetic_coach(handler, "key", active_staff)
            mocked.assert_not_called()
        self.assertEqual(handler.result[0], 200)
        self.assertLessEqual(handler.result[1]["score"], 20)
        self.assertFalse(handler.result[1]["ready"])

    def test_accepts_personal_upload_data_image(self):
        payload = valid_payload()
        payload["case"]["image_url"] = (
            "data:image/jpeg;base64,"
            + base64.b64encode(b"temporary-personal-training-image").decode("ascii")
        )
        feedback = {
            "score": 81,
            "affirmation": "你准确指出了整体轮廓。",
            "omissions": ["再补充重量位置"],
            "follow_up": "脸周线条如何影响重心？",
            "ready": True,
            "model": coach.MODEL,
        }
        handler = FakeHandler(payload)
        with mock.patch.object(coach, "_call_openrouter", return_value=feedback) as mocked:
            coach.handle_aesthetic_coach(handler, "key", active_staff)
            mocked.assert_called_once()
        self.assertEqual(handler.result[0], 200)
        self.assertEqual(handler.result[1]["score"], 81)

    def test_normalizer_limits_score_and_omissions(self):
        result = coach._normalized_feedback(
            {
                "score": 130,
                "affirmation": "具体肯定",
                "omissions": ["一", "二", "三", "四"],
                "follow_up": "为什么？",
            }
        )
        self.assertEqual(result["score"], 100)
        self.assertEqual(len(result["omissions"]), 3)

    def test_model_fallback_uses_second_candidate(self):
        payload = valid_payload()
        with mock.patch.object(coach, "_model_candidates", return_value=["openai/o3", "openai/gpt-4o-mini"]):
            with mock.patch.object(
                coach,
                "_call_openrouter_once",
                side_effect=[
                    urllib.error.HTTPError("http://x", 400, "bad request", None, None),
                    {
                        "score": 86,
                        "affirmation": "你的因果解释更完整了。",
                        "omissions": ["再补充一条证据"],
                        "follow_up": "这条判断在什么顾客条件下不成立？",
                        "ready": True,
                        "model": "openai/gpt-4o-mini",
                    },
                ],
            ):
                handler = FakeHandler(payload)
                coach.handle_aesthetic_coach(handler, "key", active_staff)
        self.assertEqual(handler.result[0], 200)
        self.assertEqual(handler.result[1]["model"], "openai/gpt-4o-mini")


if __name__ == "__main__":
    unittest.main()
