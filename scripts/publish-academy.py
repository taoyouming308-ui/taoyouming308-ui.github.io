#!/usr/bin/env python3
"""Validate real review records and stage a candidate. Never push, merge or approve."""
import argparse
import datetime as dt
import hashlib
import html
from html.parser import HTMLParser
import json
import os
import re
import tempfile
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECTIONS = (("热烫专业理论", "theory"), ("科研证据与可信度", "evidence"),
            ("门店实战案例", "case"), ("美感与人物设计", "design"),
            ("图示讲解", "diagrams"), ("排杠拆解", "winding"),
            ("顾客沟通", "communication"), ("先练后看答案", "exercise"),
            ("毛束实验", "experiment"), ("今日结论卡", "conclusion"))
REQUIRED = tuple(key for _, key in SECTIONS)
LEGACY_20261011_SHA = "f0f136639e1cd1db2fe533ee51cdaeaa83181dadfea7550b7a6aee30fd5975dc"
PAYLOAD = ("schemaVersion", "date", "title", *REQUIRED, "caseType",
           "caseAuthorization", "sources", "images", "metadata")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(data):
    return json.dumps(data, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def require(value, message):
    if not value:
        raise ValueError(message)


def text(value):
    return isinstance(value, str) and bool(value.strip())


def https(value):
    if not isinstance(value, str):
        return False
    url = urllib.parse.urlsplit(value)
    return url.scheme == "https" and bool(url.hostname) and not url.username and not url.password


def unique_ids(rows, label):
    require(isinstance(rows, list), label + " must be a list")
    ids = [row.get("id") for row in rows if isinstance(row, dict)]
    require(len(ids) == len(rows) and all(text(i) for i in ids)
            and len(set(ids)) == len(ids), label + " requires unique nonempty IDs")
    return set(ids)


def validate_asset(root, date, image):
    path = image.get("path")
    require(isinstance(path, str) and re.fullmatch(r"[A-Za-z0-9_./-]+", path),
            "Image path must be a local ASCII asset path")
    relative = Path(path)
    require(not relative.is_absolute() and ".." not in relative.parts
            and relative.parts[:2] == ("assets", date), "Image path escapes dated assets")
    current = root / "academy"
    require(not current.is_symlink(), "Symlinked academy directory forbidden")
    for part in relative.parts:
        current /= part
        require(not current.is_symlink(), "Symlinked asset path forbidden")
    file = (root / "academy" / relative).resolve()
    require(file.is_relative_to((root / "academy" / "assets" / date).resolve())
            and file.is_file(), "Missing image or escaping symlink")
    require(file.stat().st_size <= 5 * 1024 * 1024, "Image exceeds 5 MiB")
    data = file.read_bytes()
    suffix = file.suffix.lower()
    if suffix == ".svg":
        raw = data.decode("utf-8")
        require(not re.search(r"<!DOCTYPE|<!ENTITY", raw, re.I), "SVG declarations forbidden")
        require(not re.search(r"<\?(?!xml\s)", raw, re.I), "SVG processing instructions forbidden")
        allowed = {"svg", "g", "defs", "marker", "path", "line", "polyline", "polygon",
                   "circle", "ellipse", "rect", "text", "tspan", "title", "desc"}
        svg = ET.fromstring(raw)
        require(svg.tag == "{http://www.w3.org/2000/svg}svg", "SVG namespace required")
        for node in svg.iter():
            require(node.tag.startswith("{http://www.w3.org/2000/svg}")
                    and node.tag.split("}")[-1] in allowed, "Unsafe SVG element")
            for key, value in node.attrib.items():
                key = key.split("}")[-1].lower()
                # Drawing markers may reference a local ID; external resources remain forbidden.
                checked = re.sub(r"url\(\s*#[A-Za-z_][A-Za-z0-9_.:-]*\s*\)", "", value, flags=re.I)
                require(not key.startswith("on") and key not in {"href", "src"}
                        and not re.search(r"javascript:|https?:|data:|url\s*\(", checked, re.I),
                        "Active or external SVG attribute forbidden")
    elif suffix == ".png":
        require(data.startswith(b"\x89PNG\r\n\x1a\n"), "Not a PNG")
    elif suffix in {".jpg", ".jpeg"}:
        require(data.startswith(b"\xff\xd8") and data.endswith(b"\xff\xd9"), "Not a JPEG")
    elif suffix == ".webp":
        require(data[:4] == b"RIFF" and data[8:12] == b"WEBP", "Not a WebP")
    else:
        raise ValueError("Only local SVG/PNG/JPEG/WebP figures are supported")
    return file, sha(data)


def digest_draft(root, date, draft):
    require(not (set(draft) - set(PAYLOAD) - {"approved"}), "Unknown draft fields are not reviewed")
    require(draft.get("schemaVersion") == 2 and draft.get("date") == date,
            "Expected schemaVersion 2 and requested Shanghai date")
    require(text(draft.get("title")), "Missing title")
    metadata = draft.get("metadata") or {}
    require(isinstance(metadata, dict) and not (set(metadata) -
            {"learningMode", "freshnessNote", "estimatedStudyMinutes", "continuityNote"}),
            "Unknown lesson metadata")
    require(all(text(value) for key, value in metadata.items() if key != "estimatedStudyMinutes")
            and ("estimatedStudyMinutes" not in metadata or
                 (type(metadata["estimatedStudyMinutes"]) is int and 1 <= metadata["estimatedStudyMinutes"] <= 240)),
            "Invalid lesson metadata")
    for key in REQUIRED:
        require(isinstance(draft.get(key), str) and len(draft[key].strip()) >= 30,
                "Missing or too short section: " + key)
    require("<script" not in json.dumps(draft, ensure_ascii=False).lower(),
            "Scripts forbidden in draft")
    require(draft.get("caseType") in {"simulation", "authorized_real"}, "Declare caseType")
    if draft["caseType"] == "authorized_real":
        require(text(draft.get("caseAuthorization")), "Real case requires public-use authorization")
    sources = draft.get("sources")
    require(unique_ids(sources, "sources"), "At least one real source is required")
    for source in sources:
        require({"id", "title", "url", "author", "publishedAt", "evidenceLevel",
                 "basis", "supports", "limits"} <= set(source), "Incomplete source metadata")
        require(text(source.get("title")) and https(source.get("url")), "Source title/HTTPS URL required")
        require(source.get("author") is None or text(source.get("author")), "Unknown author must be null")
        require(source.get("publishedAt") is None or
                (isinstance(source.get("publishedAt"), str) and
                 re.fullmatch(r"\d{4}(?:-\d{2}-\d{2})?", source["publishedAt"])),
                "Unknown publication date must be null; otherwise use year or ISO date")
        if source.get("publishedAt"):
            if len(source["publishedAt"]) == 4:
                require(int(source["publishedAt"]) > 0, "Invalid publication year")
            else:
                dt.date.fromisoformat(source["publishedAt"])
        require(source.get("evidenceLevel") in {"strong", "medium", "weak", "强", "中", "弱"}
                and all(text(source.get(k)) for k in ("basis", "supports", "limits")),
                "Source needs evidence level, basis, support and limitations")
    images = draft.get("images")
    require(unique_ids(images, "images"), "At least one actual licensed figure is required")
    files, hashes = {}, {}
    for image in images:
        require(text(image.get("alt")) and text(image.get("caption"))
                and image.get("section", "diagrams") in REQUIRED, "Figure alt/caption/section required")
        rights = image.get("rights")
        require(isinstance(rights, dict) and rights.get("type") in
                {"original", "licensed", "public_domain", "permission"}
                and text(rights.get("credit")) and text(rights.get("basis")), "Figure rights proof required")
        file, value = validate_asset(root, date, image)
        require(image["path"] not in hashes, "Duplicate figure path")
        files[image["path"]], hashes[image["path"]] = file, value
    payload = {key: draft.get(key) for key in PAYLOAD}
    return {"contentSha256": sha(canonical(payload)), "assetSha256": hashes}, files


def validate_review(date, draft, review, digests):
    require(not (set(review) - {"schemaVersion", "date", "status", "reviewedBy",
            "reviewedAt", "approvalReference", "privacyVerified", "sourceChecks",
            "rightsChecks", "contentSha256", "assetSha256"}), "Unknown review fields")
    require(review.get("schemaVersion") == 1 and review.get("date") == date
            and review.get("status") == "approved", "Review is not an approved dated record")
    require(text(review.get("reviewedBy")) and text(review.get("approvalReference")),
            "Actual reviewer role/identity and real approval reference required")
    timestamp = dt.datetime.fromisoformat(str(review.get("reviewedAt", "")).replace("Z", "+00:00"))
    require(timestamp.tzinfo is not None and timestamp <=
            dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5), "Invalid review time")
    require(review.get("privacyVerified") is True, "Public privacy check required")
    for key, expected in digests.items():
        require(review.get(key) == expected, "Review hash mismatch: " + key)
    for key, expected in (("sourceChecks", unique_ids(draft["sources"], "sources")),
                          ("rightsChecks", unique_ids(draft["images"], "images"))):
        rows = review.get(key)
        require(unique_ids(rows, key) == expected and
                all(row.get("verified") is True and text(row.get("basis")) for row in rows),
                key + " must explicitly verify every referenced item")
    require(draft.get("approved") is not False, "Legacy approved:false conflicts with review")


def render(draft, review):
    def paragraph(value):
        return html.escape(value.replace("\\n", "\n")).replace("\n", "<br>")
    sections = []
    for heading, key in SECTIONS:
        figures = []
        for image in draft["images"]:
            if image.get("section", "diagrams") == key:
                src = html.escape(urllib.parse.quote(image["path"], safe="/"), quote=True)
                figures.append('<figure><a href="' + src +
                               '" target="_blank" rel="noopener" title="点击查看原图"><img loading="lazy" src="' + src +
                               '" alt="' + html.escape(image["alt"], quote=True) + '"></a><figcaption>' +
                               paragraph(image["caption"]) + ' · 点击查看原图 · ' +
                               paragraph(image["rights"]["credit"]) + '</figcaption></figure>')
        sections.append("<section><h2>" + heading + "</h2><p>" + paragraph(draft[key]) +
                        "</p>" + "".join(figures) + "</section>")
    sources = "".join('<li><a href="' + html.escape(s["url"], quote=True) +
                      '" rel="noopener">' + html.escape(s["title"]) + '</a> · ' +
                      html.escape(s.get("author") or "作者未知") + " · " +
                      html.escape(s.get("publishedAt") or "发表日期未知") + "<br>" +
                      paragraph(s["basis"] + "；支持：" + s["supports"] + "；限制：" + s["limits"]) +
                      "</li>" for s in draft["sources"])
    metadata = draft.get("metadata") or {}
    intro = "".join("<p>" + paragraph(metadata[key]) + "</p>"
                    for key in ("learningMode", "freshnessNote", "continuityNote") if metadata.get(key))
    if metadata.get("estimatedStudyMinutes"):
        intro = "<p>建议研习约 " + str(metadata["estimatedStudyMinutes"]) + " 分钟</p>" + intro
    style = ('body{max-width:760px;margin:auto;padding:24px;font:16px/1.8 -apple-system,'
             '"PingFang SC",sans-serif;background:#faf9f6;color:#222}'
             'section{background:white;border-radius:12px;padding:18px;margin:18px 0}'
             'h1{line-height:1.4}h2{font-size:20px}nav{display:flex;gap:18px;flex-wrap:wrap}'
             'a{color:inherit}figure{margin:18px 0}img{max-width:100%;height:auto;display:block}'
             'figcaption,aside{font-size:13px;color:#555;overflow-wrap:anywhere}')
    return ('<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
            html.escape(draft["title"]) + "</title><style>" + style + '</style><nav>'
            '<a href="../perm-app.html">← 返回自由手艺人</a><a href="index.html">课程目录</a>'
            "</nav><small><p>" + draft["date"] + "</p></small><h1>" +
            html.escape(draft["title"]) + "</h1><aside>" + intro + "</aside>" + "".join(sections) +
            '<section><h2>来源与审核范围</h2><ul>' + sources + '</ul><aside>案例类型：' +
            ("模拟教学" if draft["caseType"] == "simulation" else "已授权案例") +
            "。来源核验执行者：" + html.escape(review["reviewedBy"]) +
            "。审核记录说明来源、版权和适用限制，不代表新增科学验证或效果保证。</aside></section></html>")


def catalog(root, new_course=None):
    class Heading(HTMLParser):
        def __init__(self):
            super().__init__()
            self.active = False
            self.parts = []
        def handle_starttag(self, tag, attrs):
            if tag == "h1":
                self.active = True
        def handle_endtag(self, tag):
            if tag == "h1":
                self.active = False
        def handle_data(self, value):
            if self.active:
                self.parts.append(value)
    rows = {}
    for file in (root / "academy").glob("*.html"):
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", file.stem):
            heading = Heading()
            heading.feed(file.read_text(encoding="utf-8"))
            title = "".join(heading.parts).strip()
            require(title, "Course heading required for catalog: " + file.stem)
            rows[file.stem] = {"date": file.stem, "title": title, "url": file.name}
    if new_course:
        rows[new_course["date"]] = {"date": new_course["date"], "title": new_course["title"],
                                    "url": new_course["date"] + ".html"}
    return {"schemaVersion": 1, "items": [rows[key] for key in sorted(rows, reverse=True)]}


def stage(root, date, draft, review, digests, files, output):
    doc = render(draft, review).encode("utf-8")
    relative = "academy/" + date + ".html"
    contents = {relative: doc, "academy/drafts/" + date + ".json": canonical(draft) + b"\n",
                "academy/reviews/" + date + ".json": canonical(review) + b"\n"}
    contents["academy/catalog.json"] = canonical(catalog(root, draft)) + b"\n"
    contents.update({"academy/" + path: file.read_bytes() for path, file in files.items()})
    manifest = {"state": "candidate_ready", "date": date, **digests,
                "fileSha256": {path: sha(data) for path, data in contents.items()},
                "notice": "Not published; ordinary protected PR, validate, merge and Pages readback required"}
    if output.exists():
        require((output / "manifest.json").is_file()
                and json.loads((output / "manifest.json").read_text()) == manifest
                and all((output / path).is_file() and sha((output / path).read_bytes()) == digest
                        for path, digest in manifest["fileSha256"].items()),
                "Existing candidate differs; choose a new output directory, no overwrite")
        return manifest
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".academy-stage-", dir=output.parent) as temporary:
        temp = Path(temporary) / "bundle"
        temp.mkdir()
        for path, data in contents.items():
            file = temp / path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)
        (temp / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        os.replace(temp, output)
    return manifest


def run(root, date, output, digest_only=False):
    require(re.fullmatch(r"\d{4}-\d{2}-\d{2}", date), "Invalid date")
    dt.date.fromisoformat(date)
    if not digest_only and (root / "academy" / (date + ".html")).is_file():
        return {"state": "already_published", "date": date, "notice": "Existing repository course retained; online deployment not checked"}, 0
    source = root / "academy" / "drafts" / (date + ".json")
    if not source.is_file():
        return {"state": "missing_draft", "date": date, "notice": "No course generated or published"}, 2
    draft = json.loads(source.read_text(encoding="utf-8"))
    require(isinstance(draft, dict) and draft.get("date") == date, "Draft date mismatch")
    if digest_only:
        digests, _ = digest_draft(root, date, draft)
        return {"state": "digest_only_not_approval", "date": date, **digests}, 0
    path = root / "academy" / "reviews" / (date + ".json")
    if not path.is_file():
        return {"state": "awaiting_review", "date": date, "notice": "Real review record required"}, 3
    review = json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(review, dict), "Review record must be an object")
    if review.get("status") != "approved":
        return {"state": "awaiting_review", "date": date,
                "reviewStatus": review.get("status"), "notice": "No candidate or approval generated"}, 3
    try:
        digests, files = digest_draft(root, date, draft)
        validate_review(date, draft, review, digests)
    except (ValueError, TypeError, KeyError, OSError, ET.ParseError) as error:
        return {"state": "invalid_review", "date": date, "error": str(error)}, 4
    return stage(root, date, draft, review, digests, files, output), 0


def verify_published(root, legacy_hash=None):
    """CI guard: a new HTML file cannot bypass the reviewed draft/asset binding."""
    verified = []
    for target in sorted((root / "academy").glob("*.html")):
        date = target.stem
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            continue
        dt.date.fromisoformat(date)
        source = root / "academy/drafts" / (date + ".json")
        record = root / "academy/reviews" / (date + ".json")
        if date == "2026-10-11" and not source.exists() and sha(target.read_bytes()) == legacy_hash:
            verified.append({"date": date, "state": "unchanged_legacy_course"})
            continue
        require(source.is_file() and record.is_file(), "Published course missing draft/review: " + date)
        require(not source.is_symlink() and not record.is_symlink() and not target.is_symlink(),
                "Symlinked course/review forbidden")
        draft, review = json.loads(source.read_text()), json.loads(record.read_text())
        require(isinstance(draft, dict) and isinstance(review, dict), "Course/review must be objects")
        digests, _ = digest_draft(root, date, draft)
        validate_review(date, draft, review, digests)
        require(target.read_bytes() == render(draft, review).encode("utf-8"),
                "Published HTML differs from reviewed rendering: " + date)
        verified.append({"date": date, "state": "review_bound_course"})
    expected = catalog(root)
    path = root / "academy/catalog.json"
    require(path.is_file() and json.loads(path.read_text()) == expected,
            "Static course catalog missing or inconsistent with verified lessons")
    return {"state": "published_files_verified", "courses": verified, "catalogVerified": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", default=dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date().isoformat())
    parser.add_argument("--digest", action="store_true", help="Compute hashes only; never approve or render")
    parser.add_argument("--verify-published", action="store_true", help="CI check existing/new HTML review binding")
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    try:
        if args.verify_published:
            result, code = verify_published(ROOT, LEGACY_20261011_SHA), 0
        else:
            result, code = run(ROOT, args.date, args.output_dir or
                               ROOT / "academy-candidates" / args.date, args.digest)
    except (ValueError, TypeError, KeyError, OSError, ET.ParseError) as error:
        result, code = {"state": "invalid_input", "date": args.date, "error": str(error)}, 4
    print(json.dumps(result, ensure_ascii=False))
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as file:
            file.write("state=" + result["state"] + "\n")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as file:
            file.write("Academy: " + result["state"] + " / " + args.date +
                       ". Candidate output is not publication.\n")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
