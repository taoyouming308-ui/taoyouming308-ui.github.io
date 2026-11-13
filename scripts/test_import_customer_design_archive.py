"""Synthetic-only importer safety and interruption tests; no live HTTP writes."""

import base64
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
import urllib.error
import uuid
from unittest import mock


SPEC = importlib.util.spec_from_file_location("design_import", Path(__file__).with_name("import-customer-design-archive.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
ENDPOINT = "https://synthetic-project.supabase.co/functions/v1/employee-bookings-api"
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l0sAAAAASUVORK5CYII=")


def assessment():
    return {"outline": "Synthetic outline", "root_flow": "Synthetic flow",
            "steps": {key: "Synthetic " + key for key in MODULE.STEPS}}


def fixture(directory, photos=1, versions=2):
    config = {"endpoint": ENDPOINT, "customer_profile_id": "123", "booking_id": "456",
              "booking_date": "2026-11-08", "photos": [], "versions": []}
    for i in range(photos):
        path = directory / f"synthetic-{i}.png"
        # Distinct bytes with extra original metadata: importer must preserve it.
        path.write_bytes(PNG + b"synthetic-original-metadata:" + bytes([i]))
        config["photos"].append({"path": str(path), "stage": "before", "angle": ("front", "back", "left")[i % 3], "caption": "Synthetic original"})
    for i in range(versions):
        baseline, optimized = assessment(), assessment()
        reasons = {}
        if i:
            optimized["steps"]["bangs"] = "Synthetic revised bangs"
            reasons["bangs"] = "Synthetic agreed adjustment"
        config["versions"].append({"status": "baseline" if i == 0 else "optimizing", "baseline": baseline,
                                   "optimized": optimized, "reasons": reasons})
    path = directory / "private.json"
    path.write_text(json.dumps(config), encoding="utf-8")
    return path


class Server:
    """An idempotent, concurrency-checking API double, including lost replies."""

    def __init__(self):
        self.assets, self.versions, self.calls, self.uploads, self.originals = {}, [], [], {}, {}
        self.lost_upload_reply = False
        self.lost_save_reply = False
        self.fail_before_save = False
        self.tamper_upload = False
        self.tamper_original = False
        self.cross_origin = False
        self.signed_url = ENDPOINT.split("/functions")[0] + "/storage/v1/object/sign/private/original.png?token=SYNTHETIC_SIGNED_SECRET"

    def post(self, endpoint, payload):
        assert endpoint == ENDPOINT
        self.calls.append(copy.deepcopy(payload))
        operation = payload["operation"]
        assert "session_token" not in payload
        assert "source" not in payload
        if operation == "customer_design_history":
            return {"customer_profile_id": "123", "booking_id": "456", "versions": copy.deepcopy(self.versions),
                    "latest_version_id": self.versions[-1]["id"] if self.versions else None}
        if operation == "customer_design_upload":
            request = payload["request_id"]
            if request not in self.uploads:
                data = base64.b64decode(payload["data_base64"], validate=True)
                asset_id = str(uuid.uuid4())
                asset = {"id": asset_id, "sha256": MODULE.digest(data), "byte_size": len(data),
                         "stage": payload["stage"], "angle": payload["angle"],
                         "caption": payload.get("caption", ""),
                         "customer_profile_id": "123", "booking_id": "456", "booking_date": "2026-11-08", "visit_key": "booking:456"}
                self.assets[asset_id] = asset
                self.originals[asset_id] = data
                self.uploads[request] = asset
            asset = copy.deepcopy(self.uploads[request])
            if self.lost_upload_reply:
                self.lost_upload_reply = False
                raise MODULE.ArchiveError("Synthetic upload reply lost.")
            if self.tamper_upload:
                asset["sha256"] = "0" * 64
            return {"asset": asset}
        if operation == "customer_design_save":
            if self.fail_before_save:
                raise MODULE.ArchiveError("Synthetic interruption before save.")
            existing = next((v for v in self.versions if v["request_id"] == payload["request_id"]), None)
            if existing:
                return {"saved": True, "version": copy.deepcopy(existing)}
            current = self.versions[-1]["id"] if self.versions else None
            if payload["expected_latest_version_id"] != current:
                raise MODULE.ArchiveError("Synthetic concurrency conflict.")
            version = {key: copy.deepcopy(payload[key]) for key in ("request_id", "status", "baseline", "optimized", "reasons", "archive_url")}
            version.update({key: copy.deepcopy(payload[key]) for key in ("execution", "process", "review") if key in payload})
            version.update({"id": str(uuid.uuid4()), "source": "chatgpt", "photos": [self.assets[id].copy() for id in payload["photo_ids"]],
                            "customer_profile_id": "123", "booking_id": "456", "booking_date": "2026-11-08", "visit_key": "booking:456"})
            self.versions.append(version)
            if self.lost_save_reply:
                self.lost_save_reply = False
                raise MODULE.ArchiveError("Synthetic committed save reply lost.")
            return {"saved": True, "version": copy.deepcopy(version)}
        if operation == "customer_design_photo_urls":
            return {"assets": [{"id": id, "url": "https://attacker.invalid/photo?token=SYNTHETIC_SIGNED_SECRET"
                                if self.cross_origin else self.signed_url.replace("original.png", id + ".png")}
                               for id in payload["asset_ids"]]}
        raise AssertionError("Unexpected operation")

    def download(self, url):
        asset_id = MODULE.urllib.parse.urlsplit(url).path.rsplit("/", 1)[-1].removesuffix(".png")
        assert url == self.signed_url.replace("original.png", asset_id + ".png")
        value = self.originals[asset_id]
        return value + b"tampered" if self.tamper_original else value


class ImportSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.path = fixture(self.directory)
        self.server = Server()

    def tearDown(self):
        self.temp.cleanup()

    def prepare(self):
        return MODULE.prepare(self.path)

    def run_import(self, verify=False):
        return MODULE.ImportRunner(self.path, self.server).run(verify_originals=verify)

    def test_prepare_only_exposes_hash_and_keeps_private_stable_progress(self):
        original = self.path.read_text()
        prepared = self.prepare()
        private = json.loads(self.path.read_text())
        token = private["_import"]["ingest_token"]
        self.assertEqual(len(token), 64)
        self.assertEqual(prepared["token_sha256"], MODULE.digest(token.encode("ascii")))
        self.assertEqual(set(prepared), {"token_sha256", "customer_profile_id", "booking_id", "booking_date"})
        self.assertNotIn(token, json.dumps(prepared))
        self.assertNotIn(token, original)
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.prepare(), prepared)
        self.assertEqual(json.loads(self.path.read_text())["_import"], private["_import"])
        changed = MODULE.prepare(self.path, rotate_token=True)
        self.assertNotEqual(changed["token_sha256"], prepared["token_sha256"])
        self.assertEqual(json.loads(self.path.read_text())["_import"]["photos"], private["_import"]["photos"])

    def test_original_bytes_saved_versions_and_download_hash_readback(self):
        self.prepare()
        result = self.run_import(verify=True)
        self.assertEqual(result["photos_saved"], 1)
        self.assertEqual(result["versions_saved"], 2)
        self.assertEqual(result["asset_sha256_verified"], 1)
        self.assertEqual(result["download_sha256_verified"], 1)
        original = (self.directory / "synthetic-0.png").read_bytes()
        self.assertEqual(next(iter(self.server.originals.values())), original)
        self.assertEqual(self.server.versions[0]["baseline"]["steps"]["bangs"], "Synthetic bangs")
        self.assertEqual(self.server.versions[1]["optimized"]["steps"]["bangs"], "Synthetic revised bangs")
        self.assertEqual(self.server.versions[1]["reasons"]["bangs"], "Synthetic agreed adjustment")
        self.assertEqual(len(self.server.uploads), 1)
        self.run_import(verify=True)
        self.assertEqual(len(self.server.uploads), 1)
        self.assertEqual(len(self.server.versions), 2)
        self.assertEqual(sum(c["operation"] == "customer_design_upload" for c in self.server.calls), 1)
        self.assertEqual(sum(c["operation"] == "customer_design_save" for c in self.server.calls), 2)

    def test_lost_upload_reply_replays_stable_uuid_and_original_bytes_once(self):
        self.prepare()
        self.server.lost_upload_reply = True
        with self.assertRaisesRegex(MODULE.ArchiveError, "upload reply"):
            self.run_import()
        self.assertEqual(len(self.server.uploads), 1)
        self.assertEqual(len(self.server.versions), 0)
        self.run_import()
        uploads = [c for c in self.server.calls if c["operation"] == "customer_design_upload"]
        self.assertEqual(len(uploads), 2)
        self.assertEqual(uploads[0], uploads[1])
        self.assertEqual(len(self.server.uploads), 1)

    def test_three_view_originals_remain_distinct_and_shared_across_two_versions(self):
        self.path = fixture(self.directory, photos=3)
        self.prepare()
        result = self.run_import(verify=True)
        self.assertEqual(result["photos_saved"], 3)
        self.assertEqual(result["download_sha256_verified"], 3)
        expected = {(self.directory / f"synthetic-{i}.png").read_bytes() for i in range(3)}
        self.assertEqual(set(self.server.originals.values()), expected)
        self.assertEqual(len(self.server.assets), 3)
        for version in self.server.versions:
            self.assertEqual({p["angle"] for p in version["photos"]}, {"front", "back", "left"})
            self.assertEqual({p["id"] for p in version["photos"]}, set(self.server.assets))

    def test_lost_committed_save_reply_replays_same_precondition_and_uuid(self):
        self.prepare()
        self.server.lost_save_reply = True
        with self.assertRaisesRegex(MODULE.ArchiveError, "save reply"):
            self.run_import()
        progress = json.loads(self.path.read_text())["_import"]
        self.assertIsNone(progress["versions"][0]["expected_latest_version_id"])
        self.assertNotIn("version_id", progress["versions"][0])
        self.assertEqual(len(self.server.versions), 1)
        self.run_import()
        saves = [c for c in self.server.calls if c["operation"] == "customer_design_save"]
        self.assertEqual(saves[0], saves[1])
        self.assertEqual(len(self.server.versions), 2)

    def test_conflict_does_not_adopt_new_latest_or_blindly_repeat_write(self):
        self.prepare()
        self.server.fail_before_save = True
        with self.assertRaises(MODULE.ArchiveError):
            self.run_import()
        self.server.fail_before_save = False
        self.server.versions.append({"id": str(uuid.uuid4()), "request_id": str(uuid.uuid4())})
        with self.assertRaisesRegex(MODULE.ArchiveError, "concurrency"):
            self.run_import()
        saves = [c for c in self.server.calls if c["operation"] == "customer_design_save"]
        self.assertEqual(len(saves), 2)
        self.assertEqual(saves[0], saves[1])
        self.assertEqual(len(self.server.versions), 1)

    def test_second_version_after_partial_success_keeps_previous_chain(self):
        self.prepare()
        original_post = self.server.post
        def intercept(endpoint, payload):
            if payload["operation"] == "customer_design_save" and len(self.server.versions) == 1:
                raise MODULE.ArchiveError("Synthetic interruption")
            return original_post(endpoint, payload)
        self.server.post = intercept
        with self.assertRaises(MODULE.ArchiveError):
            self.run_import()
        self.server.post = original_post
        self.server.versions.append({"id": str(uuid.uuid4()), "request_id": str(uuid.uuid4())})
        with self.assertRaisesRegex(MODULE.ArchiveError, "concurrency"):
            self.run_import()
        self.assertEqual(len(self.server.versions), 2)

    def test_changed_file_or_design_cannot_reuse_prepared_request_id(self):
        self.prepare()
        original = self.path.read_text()
        config = json.loads(original)
        config["versions"][1]["optimized"]["steps"]["bangs"] = "Changed input"
        MODULE.save_private(self.path, config)
        with self.assertRaisesRegex(MODULE.ArchiveError, "changed"):
            self.run_import()
        self.path.write_text(original)
        (self.directory / "synthetic-0.png").write_bytes(PNG + b"changed")
        with self.assertRaisesRegex(MODULE.ArchiveError, "changed"):
            self.run_import()
        self.assertEqual(self.server.calls, [])

    def test_rejects_upload_metadata_and_download_byte_tampering(self):
        self.prepare()
        self.server.tamper_upload = True
        with self.assertRaisesRegex(MODULE.ArchiveError, "digest"):
            self.run_import()
        self.assertEqual(len(self.server.versions), 0)
        self.server.tamper_upload = False
        self.server.tamper_original = True
        with self.assertRaisesRegex(MODULE.ArchiveError, "differs"):
            self.run_import(verify=True)
        self.assertEqual(len(self.server.versions), 2)
        self.assertFalse(json.loads(self.path.read_text())["_import"]["photos"][0].get("original_verified"))

    def test_endpoint_and_signed_download_url_restrictions(self):
        invalid = ["http://synthetic-project.supabase.co/functions/v1/employee-bookings-api",
                   "https://supabase.co.attacker.invalid/functions/v1/employee-bookings-api",
                   "https://user:secret@synthetic-project.supabase.co/functions/v1/employee-bookings-api",
                   ENDPOINT + "?token=secret", ENDPOINT + "#secret", ENDPOINT.replace(".co/", ".co:444/"),
                   ENDPOINT.replace("employee-bookings-api", "other-function")]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(MODULE.ArchiveError):
                MODULE.endpoint_url(value)
        self.assertEqual(MODULE.endpoint_url(ENDPOINT), ENDPOINT)
        self.prepare()
        self.server.cross_origin = True
        with self.assertRaisesRegex(MODULE.ArchiveError, "untrusted"):
            self.run_import(verify=True)

    def test_redirect_refused_and_network_errors_redacted(self):
        transport = MODULE.Transport()
        self.assertIsNone(MODULE.NoRedirect().redirect_request(None, None, 302, "", {}, "https://attacker.invalid"))
        private = "SYNTHETIC_TOKEN_AND_FULL_PHONE_13800000000"
        for error in (urllib.error.URLError(private), urllib.error.HTTPError(ENDPOINT + "?" + private, 403, private, {}, io.BytesIO(private.encode()))):
            with self.subTest(error=type(error).__name__), mock.patch.object(transport.opener, "open", side_effect=error):
                with self.assertRaises(MODULE.ArchiveError) as raised:
                    transport.post(ENDPOINT, {"ingest_token": private})
                self.assertNotIn(private, str(raised.exception))
                self.assertNotIn("13800000000", str(raised.exception))

    def test_cli_output_never_contains_token_photos_or_signed_url(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            self.assertEqual(MODULE.main(["prepare", "--config", str(self.path)]), 0)
        token = json.loads(self.path.read_text())["_import"]["ingest_token"]
        with mock.patch.object(MODULE, "Transport", return_value=self.server), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            self.assertEqual(MODULE.main(["import", "--config", str(self.path), "--verify-originals"]), 0)
        output = out.getvalue() + err.getvalue()
        self.assertNotIn(token, output)
        self.assertNotIn("SYNTHETIC_SIGNED_SECRET", output)
        self.assertNotIn(base64.b64encode(PNG).decode(), output)
        self.assertNotIn("Synthetic revised bangs", output)
        self.assertEqual(Path(str(self.path) + ".lock").stat().st_mode & 0o777, 0o600)

    def test_invalid_scope_and_missing_adjustment_reason_fail_before_any_request(self):
        config = json.loads(self.path.read_text())
        config["versions"][1]["reasons"] = {}
        MODULE.save_private(self.path, config)
        with self.assertRaisesRegex(MODULE.ArchiveError, "reason"):
            self.prepare()
        config["customer_profile_id"] = "123&other=456"
        MODULE.save_private(self.path, config)
        with self.assertRaisesRegex(MODULE.ArchiveError, "identifiers"):
            self.prepare()
        self.assertEqual(self.server.calls, [])

    def test_backend_size_limit_and_reason_normalization(self):
        (self.directory / "synthetic-0.png").write_bytes(PNG + b"x" * MODULE.MAX_PHOTO_BYTES)
        with self.assertRaisesRegex(MODULE.ArchiveError, "8 MiB"):
            self.prepare()
        self.path = fixture(self.directory)
        config = json.loads(self.path.read_text())
        config["versions"][1]["optimized"]["steps"]["bangs"] = "  Synthetic revised bangs  "
        config["versions"][1]["reasons"]["bangs"] = "  Synthetic agreed adjustment  "
        MODULE.save_private(self.path, config)
        self.prepare()
        self.run_import()
        self.assertEqual(set(self.server.versions[1]["reasons"]), set(MODULE.FIELDS))
        self.assertEqual(self.server.versions[1]["reasons"]["outline"], "")
        self.assertEqual(self.server.versions[1]["reasons"]["bangs"], "Synthetic agreed adjustment")
        self.assertEqual(self.server.versions[1]["optimized"]["steps"]["bangs"], "Synthetic revised bangs")

    def test_private_config_guard_and_nonblocking_single_writer_lock(self):
        with self.assertRaisesRegex(MODULE.ArchiveError, "outside"):
            MODULE.private_path(str(MODULE.REPOSITORY / "private.json"))
        alias = self.directory / "alias.json"
        alias.symlink_to(self.path)
        with self.assertRaisesRegex(MODULE.ArchiveError, "securely"):
            MODULE.read_private(alias)
        with MODULE.config_lock(self.path):
            with self.assertRaisesRegex(MODULE.ArchiveError, "Another import"):
                with MODULE.config_lock(self.path):
                    pass
        # macOS may expose the same temporary directory through /var and /private/var.
        self.assertEqual(MODULE.private_path(str(self.path)).resolve(), self.path.resolve())

    def test_optional_archive_link_is_restricted_and_retained_in_each_version(self):
        config = json.loads(self.path.read_text())
        link = "https://chatgpt.com/space/page_synthetic_archive"
        for version in config["versions"]:
            version["archive_url"] = link
        MODULE.save_private(self.path, config)
        self.prepare()
        self.run_import()
        self.assertTrue(all(v["archive_url"] == link for v in self.server.versions))
        for url in ("http://chatgpt.com/space/page_synthetic", "https://chatgpt.com.attacker.invalid/space/page_synthetic",
                    "https://chatgpt.com/space/page_synthetic?secret=x", "https://chatgpt.com/other/page_synthetic",
                    "https://user:secret@chatgpt.com/space/page_synthetic"):
            with self.subTest(url=url), self.assertRaises(MODULE.ArchiveError):
                MODULE.archive_url(url)

    def test_rotation_after_failed_save_preserves_every_write_precondition(self):
        self.prepare()
        self.server.fail_before_save = True
        with self.assertRaises(MODULE.ArchiveError):
            self.run_import()
        before = json.loads(self.path.read_text())["_import"]
        MODULE.prepare(self.path, rotate_token=True)
        after = json.loads(self.path.read_text())["_import"]
        self.assertNotEqual(before["ingest_token"], after["ingest_token"])
        self.assertEqual(before["photos"], after["photos"])
        self.assertEqual(before["versions"], after["versions"])

    def test_per_record_scope_is_verified_even_with_matching_envelope_and_content(self):
        self.prepare()
        self.run_import()
        for key, value in (("customer_profile_id", "124"), ("booking_id", "457"), ("booking_date", "2026-11-09"), ("visit_key", "booking:457")):
            original = self.server.versions[0][key]
            self.server.versions[0][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(MODULE.ArchiveError, "did not match"):
                self.run_import()
            self.server.versions[0][key] = original
        self.server.versions[0]["photos"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(MODULE.ArchiveError, "digest"):
            self.run_import()

    def test_readback_retains_photo_stage_and_view_labels(self):
        self.prepare()
        self.run_import()
        self.server.versions[0]["photos"][0]["angle"] = "back"
        with self.assertRaisesRegex(MODULE.ArchiveError, "stage or angle"):
            self.run_import()
        self.server.versions[0]["photos"][0]["angle"] = "front"
        self.server.versions[0]["photos"][0]["caption"] = "Incorrect caption"
        with self.assertRaisesRegex(MODULE.ArchiveError, "caption"):
            self.run_import()

    def test_manual_same_day_visit_key_is_bound_to_grant_target(self):
        config = json.loads(self.path.read_text())
        del config["booking_id"]
        config["visit_key"] = "manual:2026-11-08:" + str(uuid.uuid4())
        MODULE.save_private(self.path, config)
        prepared = self.prepare()
        self.assertIsNone(prepared["booking_id"])
        self.assertEqual(prepared["visit_key"], config["visit_key"])
        runner = MODULE.ImportRunner(self.path, self.server)
        runner.verify_record_scope({"customer_profile_id": "123", "booking_id": None,
                                    "booking_date": "2026-11-08", "visit_key": config["visit_key"]})
        with self.assertRaisesRegex(MODULE.ArchiveError, "visit"):
            runner.verify_record_scope({"customer_profile_id": "123", "booking_id": None,
                                        "booking_date": "2026-11-08", "visit_key": "manual:2026-11-08"})
        config["visit_key"] = "manual:2026-11-09:" + str(uuid.uuid4())
        with self.assertRaisesRegex(MODULE.ArchiveError, "Visit key"):
            MODULE.validate_config(config)

    def test_atomic_progress_survives_replace_failure(self):
        self.prepare()
        previous = self.path.read_bytes()
        with mock.patch.object(MODULE.os, "replace", side_effect=OSError("SYNTHETIC_PRIVATE_PATH")):
            with self.assertRaisesRegex(MODULE.ArchiveError, "atomically"):
                MODULE.save_private(self.path, {"test": "new"})
        self.assertEqual(self.path.read_bytes(), previous)
        self.assertEqual(list(self.directory.glob(".archive-import-*")), [])

    def test_six_zone_process_review_round_trip_is_independent_of_eight_steps(self):
        config = json.loads(self.path.read_text())
        config["versions"][1].update({
            "execution": {"top": {"issue": "  Synthetic flat crown  ", "target": "Some lift",
                                    "actions": "Retain surface length", "check": "Natural fall"},
                          "ear_front": {"target": "Face framing"}},
            "process": {"styling": "  Hand dry  ", "proposal": "Agreed synthetic plan"},
            "review": {"achieved": "  Shape retained  ", "pending": "Wash-day check", "next": "Recheck crown"}})
        MODULE.save_private(self.path, config)
        self.prepare()
        self.run_import(verify=True)
        saved = self.server.versions[1]
        self.assertEqual(saved["execution"]["top"], {"issue": "Synthetic flat crown", "target": "Some lift",
                                                    "actions": "Retain surface length", "check": "Natural fall"})
        self.assertEqual(saved["execution"]["ear_front"], {"issue": "", "target": "Face framing", "actions": "", "check": ""})
        self.assertEqual(saved["execution"]["bottom"], {"issue": "", "target": "", "actions": "", "check": ""})
        self.assertEqual(set(saved["execution"]), {"bangs", "top", "ear_front", "ear_back", "middle", "bottom"})
        self.assertEqual(saved["process"]["styling"], "Hand dry")
        self.assertEqual(saved["process"]["application"], "")
        self.assertEqual(saved["review"], {"achieved": "Shape retained", "pending": "Wash-day check", "next": "Recheck crown"})
        self.assertNotIn("execution", self.server.versions[0])
        self.assertEqual(saved["optimized"]["steps"]["bangs"], "Synthetic revised bangs")
        self.run_import()
        self.assertEqual(len(self.server.versions), 2)

    def test_legacy_prepared_manifest_and_write_payload_remain_unchanged(self):
        config = json.loads(self.path.read_text())
        originals = []
        for photo in config["photos"]:
            data = Path(photo["path"]).read_bytes()
            originals.append({"sha256": MODULE.digest(data), "byte_size": len(data), "mime_type": "image/png"})
        old_manifest = MODULE.digest(MODULE.canonical({"config": config, "originals": originals}))
        self.prepare()
        private = json.loads(self.path.read_text())
        self.assertEqual(private["_import"]["manifest_sha256"], old_manifest)
        self.assertEqual({k: v for k, v in private.items() if k != "_import"}, config)
        self.run_import()
        saves = [c for c in self.server.calls if c["operation"] == "customer_design_save"]
        for saved in saves:
            self.assertTrue({"execution", "process", "review"}.isdisjoint(saved))
        # A new server's additive empty columns must also accept this old config.
        for version in self.server.versions:
            version.update({"execution": {}, "process": {}, "review": {}})
        self.run_import()
        self.assertEqual(len(self.server.versions), 2)

    def test_explicit_empty_fields_are_sent_while_absent_legacy_fields_are_omitted(self):
        config = json.loads(self.path.read_text())
        config["versions"][0].update({"execution": {"top": {"target": "  "}}, "process": {}, "review": {"achieved": ""}})
        MODULE.save_private(self.path, config)
        self.prepare()
        self.run_import()
        saves = [c for c in self.server.calls if c["operation"] == "customer_design_save"]
        self.assertEqual({key: saves[0][key] for key in ("execution", "process", "review")},
                         {"execution": {}, "process": {}, "review": {}})
        self.assertTrue({"execution", "process", "review"}.isdisjoint(saves[1]))

    def test_explicit_clear_is_preserved_after_nonempty_execution(self):
        config = json.loads(self.path.read_text())
        config["versions"][0]["execution"] = {"top": {"target": "Some lift"}}
        config["versions"][1]["execution"] = {}
        MODULE.save_private(self.path, config)
        self.prepare()
        self.run_import()
        saves = [c for c in self.server.calls if c["operation"] == "customer_design_save"]
        self.assertEqual(saves[0]["execution"]["top"]["target"], "Some lift")
        self.assertEqual(saves[1]["execution"], {})
        self.assertEqual(self.server.versions[1]["execution"], {})
        self.assertEqual(self.server.versions[0]["execution"]["top"]["target"], "Some lift")

    def test_new_fields_reject_unknown_keys_types_and_excess_length_before_http(self):
        initial = json.loads(self.path.read_text())
        cases = [
            {"execution": None}, {"execution": []}, {"execution": {"old_five_zone": {}}},
            {"execution": {"top": None}}, {"execution": {"top": {"angle": "90"}}},
            {"execution": {"top": {"actions": 90}}}, {"execution": {"top": {"check": "x" * 4001}}},
            {"process": None}, {"process": []}, {"process": {"unexpected": "x"}},
            {"process": {"winding": False}}, {"process": {"application": "x" * 4001}},
            {"review": None}, {"review": []}, {"review": {"satisfaction": "guessed"}},
            {"review": {"achieved": None}}, {"review": {"pending": "x" * 4001}}]
        for fields in cases:
            config = copy.deepcopy(initial)
            config["versions"][0].update(fields)
            MODULE.save_private(self.path, config)
            with self.subTest(fields=list(fields)), self.assertRaises(MODULE.ArchiveError):
                self.prepare()
        self.assertEqual(self.server.calls, [])

    def test_six_zone_change_after_prepare_cannot_reuse_immutable_request_ids(self):
        config = json.loads(self.path.read_text())
        config["versions"][1]["execution"] = {"bottom": {"actions": "Retain length"}}
        MODULE.save_private(self.path, config)
        self.prepare()
        config = json.loads(self.path.read_text())
        config["versions"][1]["execution"]["bottom"]["actions"] = "Shorten length"
        MODULE.save_private(self.path, config)
        with self.assertRaisesRegex(MODULE.ArchiveError, "changed"):
            self.run_import()
        self.assertEqual(self.server.calls, [])

    def test_new_fields_survive_lost_reply_with_same_request_and_precondition(self):
        config = json.loads(self.path.read_text())
        config["versions"][0].update({"execution": {"bangs": {"target": "Open fringe"}},
                                      "process": {"proposal": "Synthetic approved plan"},
                                      "review": {"pending": "Completion not yet recorded"}})
        MODULE.save_private(self.path, config)
        self.prepare()
        self.server.lost_save_reply = True
        with self.assertRaisesRegex(MODULE.ArchiveError, "save reply"):
            self.run_import()
        self.run_import()
        saves = [c for c in self.server.calls if c["operation"] == "customer_design_save"]
        self.assertEqual(saves[0], saves[1])
        self.assertEqual(len(self.server.versions), 2)
        self.assertEqual(self.server.versions[0]["execution"]["bangs"]["target"], "Open fringe")

    def test_final_readback_detects_dropped_execution_process_and_review(self):
        config = json.loads(self.path.read_text())
        config["versions"][0].update({"execution": {"middle": {"target": "Retain width"}},
                                      "process": {"care_texture": "Natural dry texture"},
                                      "review": {"achieved": "Observed result"}})
        MODULE.save_private(self.path, config)
        self.prepare()
        self.run_import()
        saved = copy.deepcopy(self.server.versions[0])
        for field in ("execution", "process", "review"):
            self.server.versions[0] = copy.deepcopy(saved)
            self.server.versions[0].pop(field)
            with self.subTest(field=field), self.assertRaisesRegex(MODULE.ArchiveError, "did not match"):
                self.run_import()
        self.server.versions[0] = saved
        self.run_import()


if __name__ == "__main__":
    unittest.main()
