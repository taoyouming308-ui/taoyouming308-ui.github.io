#!/usr/bin/env python3
"""Publish reviewed academy drafts only; never fabricate a lesson."""
import datetime as dt
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DRAFTS = ROOT / "academy" / "drafts"
OUT = ROOT / "academy"
REQUIRED = ("theory", "evidence", "case", "design", "diagrams", "winding", "communication", "exercise", "experiment", "conclusion")
def main():
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date().isoformat()
    source = DRAFTS / (today + ".json")
    if not source.exists():
        print("No approved draft for", today, "- skipping; no filler content.")
        return
    data = json.loads(source.read_text(encoding="utf-8"))
    if data.get("approved") is not True or data.get("date") != today:
        raise SystemExit("Draft is not approved or date does not match")
    if not isinstance(data.get("title"), str) or not data["title"].strip():
        raise SystemExit("Missing title")
    for key in REQUIRED:
        if not isinstance(data.get(key), str) or len(data[key].strip()) < 30:
            raise SystemExit("Missing or too short section: " + key)
    if "<script" in json.dumps(data).lower():
        raise SystemExit("Scripts are forbidden in lesson content")
    target = OUT / (today + ".html")
    if target.exists():
        print("Already published:", target)
        return
    sections = [("热烫专业理论","theory"),("科研证据与可信度","evidence"),("门店实战案例","case"),("美感与人物设计","design"),("图示讲解","diagrams"),("排杠拆解","winding"),("顾客沟通","communication"),("先练后看答案","exercise"),("毛束实验","experiment"),("今日结论卡","conclusion")]
    body = "".join("<section><h2>"+html.escape(name)+"</h2><p>"+html.escape(data[key]).replace("\\n","<br>")+"</p></section>" for name,key in sections)
    doc = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+html.escape(data["title"])+'</title><style>body{max-width:760px;margin:auto;padding:24px;font:16px/1.8 -apple-system,"PingFang SC",sans-serif;background:#faf9f6;color:#222}section{background:white;border-radius:12px;padding:18px;margin:18px 0}h1{line-height:1.4}h2{font-size:20px}</style><a href="index.html">← 课程目录</a><small><p>'+today+'</p></small><h1>'+html.escape(data["title"])+'</h1>'+body+'</html>'
    target.write_text(doc,encoding="utf-8")
    print("Published",target)
if __name__ == "__main__":
    main()
