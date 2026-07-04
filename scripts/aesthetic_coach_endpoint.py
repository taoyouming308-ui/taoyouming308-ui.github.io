#!/usr/bin/env python3
"""Runtime endpoint for the guided hair-aesthetic training flow.

This module is imported by the local plan server. It validates employee scope,
rate-limits model calls, and asks OpenRouter for short stage-specific feedback.
It does not persist answers or images.
"""

import datetime as dt
import json
import threading
import urllib.error
import urllib.parse
import urllib.request


MODEL = "qwen/qwen3-vl-32b-instruct"
ALLOWED_STAGES = {"observe", "analyze", "judge", "design", "review"}
ALLOWED_IMAGE_HOST = "taoyouming308-ui.github.io"
MAX_BODY_BYTES = 64 * 1024
MAX_ANSWER_CHARS = 1200
MAX_PREVIOUS_CHARS = 3600
_RATE_LOCK = threading.Lock()
_RATE_STATE = {}


STAGE_RULES = {
    "observe": (
        "训练观察能力。只评价学员是否准确描述画面事实，重点检查整体轮廓、长度比例、"
        "层次、重量、刘海、脸周、线条、纹理、发色与光泽。发现“高级、适合、显瘦、"
        "温柔”等推测时要提醒它不是观察事实。"
    ),
    "analyze": (
        "训练分析能力。检查学员是否说明设计动作与视觉结果之间的因果关系，不能只重复"
        "看见了什么。重点追问轮廓、层次、重量、长度、脸周和风格为什么这样安排。"
    ),
    "judge": (
        "训练判断能力。检查是否同时说明适合谁、不适合谁、理由、发质和维护条件，以及"
        "换一个顾客时怎样调整。不要根据单张照片武断判断完整脸型或真实发质。"
    ),
    "design": (
        "训练设计能力。检查方案能否转成轮廓、长度、层次、重量、脸周、纹理和技术路径。"
        "指出设计语言与施工动作之间最关键的断点，不给危险或脱离发质检测的化学参数。"
    ),
    "review": (
        "训练美感能力。检查学员是否从单一作品提炼出可迁移的比例、空间、重心、风格、"
        "色彩或纹理原则，并能区分剪裁、造型、人物和摄影的贡献。"
    ),
}


def _origin_allowed(origin):
    if not origin:
        return True
    if origin == "https://taoyouming308-ui.github.io":
        return True
    return origin.startswith("http://127.0.0.1:") or origin.startswith("http://localhost:")


def _client_ip(handler):
    forwarded = (handler.headers.get("CF-Connecting-IP") or handler.headers.get("X-Forwarded-For") or "").strip()
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return str(handler.client_address[0])[:64] if handler.client_address else "unknown"


def _check_rate_limit(username, ip):
    today = dt.datetime.now().strftime("%Y-%m-%d")
    keys = [
        (f"user:{username}", 40),
        (f"ip:{ip}", 80),
        ("global", 400),
    ]
    with _RATE_LOCK:
        stale = [key for key in _RATE_STATE if not key.endswith(":" + today)]
        for key in stale:
            _RATE_STATE.pop(key, None)
        for prefix, limit in keys:
            key = prefix + ":" + today
            if _RATE_STATE.get(key, 0) >= limit:
                return False
        for prefix, _ in keys:
            key = prefix + ":" + today
            _RATE_STATE[key] = _RATE_STATE.get(key, 0) + 1
    return True


def _valid_training_image(url):
    try:
        parsed = urllib.parse.urlparse(url)
        return (
            parsed.scheme == "https"
            and parsed.hostname == ALLOWED_IMAGE_HOST
            and parsed.path.startswith("/img/")
            and ".." not in parsed.path
        )
    except Exception:
        return False


def _clean_text(value, limit):
    return str(value or "").strip()[:limit]


def _parse_model_json(content):
    text = _clean_text(content, 10000)
    if "```json" in text:
        text = text.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in text:
        text = text.split("```", 1)[1].split("```", 1)[0].strip()
    return json.loads(text)


def _normalized_feedback(data):
    omissions = data.get("omissions") if isinstance(data, dict) else []
    if not isinstance(omissions, list):
        omissions = [omissions]
    omissions = [_clean_text(item, 120) for item in omissions if _clean_text(item, 120)][:3]
    try:
        score = int(float(data.get("score", 0)))
    except (TypeError, ValueError):
        score = 0
    return {
        "score": max(0, min(100, score)),
        "affirmation": _clean_text(data.get("affirmation"), 180) or "你已经完成了独立作答。",
        "omissions": omissions,
        "follow_up": _clean_text(data.get("follow_up"), 180) or "你能为这个判断再指出一个画面证据吗？",
        "ready": bool(data.get("ready", True)),
        "model": MODEL,
    }


def _employee_is_active(supabase_get, username, store):
    query = (
        "staff?select=username,store,active&username=eq."
        + urllib.parse.quote(username, safe="")
        + "&active=eq.true&limit=1"
    )
    rows = supabase_get(query)
    if not rows:
        return False
    actual_store = _clean_text(rows[0].get("store"), 80)
    return not store or actual_store == store


def _build_prompt(stage, case_data, answer, previous_answers):
    prior_lines = []
    if isinstance(previous_answers, dict):
        for key in ("observe", "analyze", "judge", "design", "review"):
            if key == stage:
                continue
            value = _clean_text(previous_answers.get(key), 700)
            if value:
                prior_lines.append(f"- {key}: {value}")
    prior_text = "\n".join(prior_lines)[:MAX_PREVIOUS_CHARS] or "无"
    reference = _clean_text(case_data.get("reference"), 1000)
    limitations = _clean_text(case_data.get("limitations"), 500)
    return f"""你是高水平发型设计导师。你的任务不是替学员给答案，而是训练他独立观察、分析、判断和设计。

当前阶段：{stage}
阶段规则：{STAGE_RULES[stage]}

案例：
- 标题：{_clean_text(case_data.get("title"), 120)}
- 分类：{_clean_text(case_data.get("category"), 80)}
- 今日重点：{_clean_text(case_data.get("focus"), 200)}
- 图片限制：{limitations}

学员本阶段回答：
{answer}

学员前面阶段的回答：
{prior_text}

内部参考解析（只能用来判断遗漏，不能整段抄给学员）：
{reference}

点评要求：
1. 先肯定一个具体做对的地方，不说空话。
2. 只指出1到3个最关键遗漏，避免一次给太多导致疲劳。
3. 学员已经明确写出的内容不能再列为遗漏；先逐句核对后再点评。
4. 只追问一个最能推动下一步思考的问题。
5. 不要求答案必须与内部参考完全一致；有作品证据、逻辑自洽的不同判断可以成立。
6. 单张照片看不到的内容必须明确说不能确定，不能猜脸型、发质或技术参数。
7. 评分衡量本次回答的证据、逻辑和完整度，不评价发型师天赋。
8. 中文短句，直接、专业，不超过260字。

只输出JSON：
{{
  "score": 0到100的整数,
  "affirmation": "一个具体做对的地方",
  "omissions": ["关键遗漏1", "关键遗漏2"],
  "follow_up": "只问一个问题",
  "ready": true
}}"""


def _call_openrouter(openrouter_key, stage, case_data, answer, previous_answers):
    prompt = _build_prompt(stage, case_data, answer, previous_answers)
    request_body = json.dumps(
        {
            "model": MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": case_data["image_url"]}},
                    ],
                }
            ],
            "max_tokens": 500,
            "temperature": 0.25,
            "response_format": {"type": "json_object"},
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=request_body,
        headers={
            "Authorization": f"Bearer {openrouter_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://taoyouming308-ui.github.io",
            "X-Title": "Free Craftsman Aesthetic Coach",
        },
    )
    with urllib.request.urlopen(request, timeout=28) as response:
        result = json.loads(response.read())
    content = result["choices"][0]["message"]["content"]
    return _normalized_feedback(_parse_model_json(content))


def handle_aesthetic_coach(handler, openrouter_key, supabase_get):
    """Handle a POST request and write the JSON response through the host handler."""
    origin = _clean_text(handler.headers.get("Origin"), 300)
    if not _origin_allowed(origin):
        handler.send_json({"error": "不允许的请求来源"}, 403)
        return

    try:
        length = int(handler.headers.get("Content-Length", 0))
    except (TypeError, ValueError):
        length = 0
    if length <= 0 or length > MAX_BODY_BYTES:
        handler.send_json({"error": "请求内容大小不合法"}, 413)
        return

    try:
        payload = json.loads(handler.rfile.read(length).decode("utf-8"))
    except Exception:
        handler.send_json({"error": "训练内容解析失败"}, 400)
        return

    username = _clean_text(payload.get("username"), 80)
    store = _clean_text(payload.get("store"), 80)
    stage = _clean_text(payload.get("stage"), 20)
    answer = _clean_text(payload.get("answer"), MAX_ANSWER_CHARS)
    case_data = payload.get("case") if isinstance(payload.get("case"), dict) else {}
    previous_answers = payload.get("previous_answers") if isinstance(payload.get("previous_answers"), dict) else {}

    if not username or stage not in ALLOWED_STAGES or len(answer) < 16:
        handler.send_json({"error": "员工、训练阶段或回答内容不完整"}, 400)
        return
    if not _valid_training_image(_clean_text(case_data.get("image_url"), 500)):
        handler.send_json({"error": "训练图片不在允许范围"}, 400)
        return
    if not openrouter_key:
        handler.send_json({"error": "AI 导师服务未配置"}, 503)
        return
    try:
        if not _employee_is_active(supabase_get, username, store):
            handler.send_json({"error": "员工状态无效，请重新登录"}, 403)
            return
    except Exception:
        handler.send_json({"error": "暂时无法核验员工状态"}, 503)
        return

    if not _check_rate_limit(username, _client_ip(handler)):
        handler.send_json({"error": "今天的 AI 点评次数已达上限，请明天继续"}, 429)
        return

    try:
        feedback = _call_openrouter(openrouter_key, stage, case_data, answer, previous_answers)
        handler.send_json(feedback)
    except urllib.error.HTTPError as error:
        handler.send_json({"error": f"AI 导师服务异常（{error.code}）"}, 502)
    except urllib.error.URLError:
        handler.send_json({"error": "AI 导师网络暂时不可用"}, 502)
    except Exception:
        handler.send_json({"error": "AI 导师暂时无法完成点评"}, 502)
