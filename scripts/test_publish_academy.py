"""Synthetic isolated fixtures; never create or approve a real course."""
import copy
import datetime as dt
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("academy_publisher", Path(__file__).with_name("publish-academy.py"))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
DATE = "2026-10-12"


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="academy-unit-fixtures-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.academy = self.root / "academy"
        (self.academy / "drafts").mkdir(parents=True)
        (self.academy / "reviews").mkdir()
        asset = self.academy / "assets" / DATE / "fixture.svg"
        asset.parent.mkdir(parents=True)
        asset.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">'
                         '<rect width="100" height="60" fill="#eee"/><text x="5" y="30">SYNTHETIC</text></svg>')
        self.asset = asset
        self.draft = {"schemaVersion": 2, "date": DATE, "title": "SYNTHETIC test, not a course",
                      "caseType": "simulation", "caseAuthorization": None,
                      **{key: "SYNTHETIC unverified fixture content for isolated tests only.\nSecond fixture line."
                         for key in p.REQUIRED},
                      "sources": [{"id": "fixture-source", "title": "SYNTHETIC, not a real paper",
                                   "url": "https://example.invalid/source", "author": None,
                                   "publishedAt": None, "evidenceLevel": "weak",
                                   "basis": "Synthetic test metadata", "supports": "No actual claim",
                                   "limits": "Not a real scientific source"}],
                      "images": [{"id": "fixture-image", "path": "assets/" + DATE + "/fixture.svg",
                                  "alt": 'SYNTHETIC "quoted" figure', "caption": "Not real course content",
                                  "section": "diagrams", "rights": {"type": "original",
                                  "credit": "SYNTHETIC fixture", "basis": "Temporary test-only drawing"}}]}
        self.output = self.root / "candidate"
        self.write_draft()
        self.refresh_review()

    def write_draft(self):
        (self.academy / "drafts" / (DATE + ".json")).write_text(json.dumps(self.draft))

    def refresh_review(self):
        self.review = {"schemaVersion": 1, "date": DATE, "status": "approved",
                       "reviewedBy": "SYNTHETIC AI source-verification fixture role",
                       "reviewedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                       "approvalReference": "SYNTHETIC isolated test, not actual approval",
                       "privacyVerified": True,
                       "sourceChecks": [{"id": "fixture-source", "verified": True, "basis": "SYNTHETIC fixture"}],
                       "rightsChecks": [{"id": "fixture-image", "verified": True, "basis": "SYNTHETIC fixture"}],
                       **p.digest_draft(self.root, DATE, self.draft)[0]}
        self.write_review()

    def write_review(self):
        (self.academy / "reviews" / (DATE + ".json")).write_text(json.dumps(self.review))

    def run_case(self):
        return p.run(self.root, DATE, self.output)

    def assert_blocked(self):
        result, code = self.run_case()
        self.assertEqual((result["state"], code), ("invalid_review", 4))
        self.assertFalse(self.output.exists())
        self.assertFalse((self.academy / (DATE + ".html")).exists())

    def test_missing_draft_is_not_green_publication(self):
        (self.academy / "drafts" / (DATE + ".json")).unlink()
        self.assertEqual(self.run_case()[0]["state"], "missing_draft")
        self.assertEqual(self.run_case()[1], 2)

    def test_pending_and_boolean_alone_do_not_render(self):
        (self.academy / "reviews" / (DATE + ".json")).unlink()
        self.draft["approved"] = True
        self.write_draft()
        self.assertEqual(self.run_case()[0]["state"], "awaiting_review")
        self.assertFalse(self.output.exists())
        self.review["status"] = "pending"
        self.write_review()
        self.assertEqual(self.run_case()[1], 3)

    def test_digest_only_never_creates_approval_or_output(self):
        review = (self.academy / "reviews" / (DATE + ".json")).read_bytes()
        result, code = p.run(self.root, DATE, self.output, True)
        self.assertEqual((result["state"], code), ("digest_only_not_approval", 0))
        self.assertEqual((self.academy / "reviews" / (DATE + ".json")).read_bytes(), review)
        self.assertFalse(self.output.exists())

    def test_body_and_source_mutations_invalidate_review(self):
        for field in ["theory", "sources"]:
            with self.subTest(field=field):
                original = copy.deepcopy(self.draft)
                if field == "theory":
                    self.draft[field] += " Changed content."
                else:
                    self.draft[field][0]["limits"] += " Changed limit."
                self.write_draft()
                self.assert_blocked()
                self.draft = original
                self.write_draft()

    def test_image_mutation_invalidate_review(self):
        self.asset.write_text(self.asset.read_text().replace("#eee", "#ddd"))
        self.assert_blocked()

    def test_missing_copyright_and_incomplete_checks_rejected(self):
        self.draft["images"][0]["rights"].pop("basis")
        self.write_draft()
        self.assert_blocked()

    def test_missing_reviewer_or_reference_rejected(self):
        for field in ["reviewedBy", "approvalReference"]:
            with self.subTest(field=field):
                old = self.review[field]
                self.review[field] = ""
                self.write_review()
                self.assert_blocked()
                self.review[field] = old

    def test_unverified_source_rights_and_privacy_rejected(self):
        for field in ["sourceChecks", "rightsChecks", "privacyVerified"]:
            with self.subTest(field=field):
                old = copy.deepcopy(self.review[field])
                if field == "privacyVerified":
                    self.review[field] = False
                else:
                    self.review[field][0]["verified"] = False
                self.write_review()
                self.assert_blocked()
                self.review[field] = old

    def test_unknown_author_date_and_actual_figures_are_preserved(self):
        result, code = self.run_case()
        self.assertEqual((result["state"], code), ("candidate_ready", 0))
        page = (self.output / "academy" / (DATE + ".html")).read_text()
        self.assertIn("作者未知", page)
        self.assertIn("发表日期未知", page)
        self.assertIn('<img loading="lazy"', page)
        self.assertIn('title="点击查看原图"', page)
        self.assertIn("SYNTHETIC &quot;quoted&quot; figure", page)
        self.assertIn("<br>Second fixture line.", page)
        self.assertEqual((self.output / "academy/assets" / DATE / "fixture.svg").read_bytes(),
                         self.asset.read_bytes())
        self.assertFalse((self.academy / (DATE + ".html")).exists())

    def test_existing_course_retained_without_new_review(self):
        target = self.academy / (DATE + ".html")
        target.write_bytes(b"EXISTING SYNTHETIC COURSE")
        (self.academy / "reviews" / (DATE + ".json")).unlink()
        self.assertEqual(self.run_case()[0]["state"], "already_published")
        self.assertEqual(target.read_bytes(), b"EXISTING SYNTHETIC COURSE")
        self.assertFalse(self.output.exists())

    def test_candidate_repeat_idempotent_and_no_overwrite(self):
        self.run_case()
        manifest = (self.output / "manifest.json").read_bytes()
        self.assertEqual(self.run_case()[0]["state"], "candidate_ready")
        self.assertEqual((self.output / "manifest.json").read_bytes(), manifest)
        (self.output / "academy" / (DATE + ".html")).write_text("CORRUPTED")
        with self.assertRaisesRegex(ValueError, "Existing candidate differs"):
            self.run_case()

    def test_active_svg_external_path_and_symlink_rejected(self):
        for raw in ['<svg><script>alert(1)</script></svg>',
                    '<svg><rect onclick="bad()"/></svg>',
                    '<!DOCTYPE svg><svg/>', '<svg><image href="https://example.invalid/a"/></svg>']:
            with self.subTest(svg=raw):
                self.asset.write_text(raw)
                self.assert_blocked()
        self.draft["images"][0]["path"] = "../private.svg"
        self.write_draft()
        self.assert_blocked()
        self.draft["images"][0]["path"] = "assets/" + DATE + "/fixture.svg"
        self.asset.unlink()
        outside = self.root / "outside.svg"
        outside.write_text("<svg/>")
        self.asset.symlink_to(outside)
        self.write_draft()
        self.assert_blocked()

    def test_real_case_without_authorization_rejected(self):
        self.draft["caseType"] = "authorized_real"
        self.write_draft()
        self.assert_blocked()

    def test_safe_local_marker_renders_but_external_reference_rejected(self):
        self.asset.write_text('<svg xmlns="http://www.w3.org/2000/svg"><defs>'
                              '<marker id="arrow"><path d="M0 0L1 1"/></marker></defs>'
                              '<line x1="0" y1="0" x2="30" y2="30" marker-end="url(#arrow)"/></svg>')
        self.refresh_review()
        self.assertEqual(self.run_case()[0]["state"], "candidate_ready")
        self.asset.write_text(self.asset.read_text().replace("url(#arrow)", "url(https://example.invalid/a)"))
        self.assertEqual(self.run_case()[0]["state"], "invalid_review")

    def test_unknown_private_fields_cannot_enter_bundle(self):
        self.draft["privateConversation"] = "SYNTHETIC private metadata"
        self.write_draft()
        self.assert_blocked()

    def test_missing_source_metadata_and_legacy_false_rejected(self):
        self.draft["sources"][0].pop("author")
        self.write_draft()
        self.assert_blocked()

        self.draft["sources"][0]["author"] = None
        self.draft["approved"] = False
        self.write_draft()
        self.assert_blocked()

    def test_ci_rejects_html_or_asset_tampering_and_unreviewed_html(self):
        self.run_case()
        page = self.output / "academy" / (DATE + ".html")
        target = self.academy / (DATE + ".html")
        target.write_bytes(page.read_bytes())
        self.assertEqual(p.verify_published(self.root)["courses"][0]["state"], "review_bound_course")
        target.write_text(target.read_text() + "<p>UNREVIEWED CHANGE</p>")
        with self.assertRaisesRegex(ValueError, "differs from reviewed"):
            p.verify_published(self.root)
        target.write_bytes(page.read_bytes())
        self.asset.write_text(self.asset.read_text().replace("#eee", "#ddd"))
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            p.verify_published(self.root)
        (self.academy / "reviews" / (DATE + ".json")).unlink()
        with self.assertRaisesRegex(ValueError, "missing draft/review"):
            p.verify_published(self.root)

    def test_svg_stylesheet_processing_instruction_and_foreign_namespace_rejected(self):
        for raw in ['<?xml-stylesheet href="https://example.invalid/x.css"?><svg xmlns="http://www.w3.org/2000/svg"/>',
                    '<svg xmlns="http://example.invalid/not-svg"><rect/></svg>']:
            with self.subTest(svg=raw):
                self.asset.write_text(raw)
                self.assert_blocked()


if __name__ == "__main__":
    unittest.main()
