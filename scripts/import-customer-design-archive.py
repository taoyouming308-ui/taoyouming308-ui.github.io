#!/usr/bin/env python3
"""Import existing ChatGPT originals and append-only design versions safely.

No employee login or service key is used. Keep the JSON config outside this
repository, in a private directory. `prepare` writes a random bearer token to
that file and prints its SHA-256 for a separate, privileged, short-lived grant.
Only run `import` after that exact customer/visit grant has been registered.

See --help. This tool never resizes/re-encodes photographs or retries a write
automatically. Re-running with the unchanged config reuses persisted UUIDs.
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import ssl
import stat
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid


REPOSITORY = Path(__file__).resolve().parent.parent
MAX_PHOTO_BYTES = 8 * 1024 * 1024
MAX_CONFIG_BYTES = 1024 * 1024
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
STEPS = ("style", "person", "length", "features", "layers", "bangs", "curls", "care")
FIELDS = ("outline", "root_flow", *STEPS)
STATUSES = {"baseline", "optimizing", "confirmed", "completed", "followup"}
STAGES = {"before", "after", "reference"}
ANGLES = {"front", "back", "left", "right", "detail"}
ZONES = ("bangs", "top", "ear_front", "ear_back", "middle", "bottom")
ZONE_FIELDS = ("issue", "target", "actions", "check")
PROCESS_FIELDS = ("care_texture", "styling", "style_feel", "application", "winding",
                  "rod_direction", "curl_control", "thinning_space", "proposal", "technique_layers")
REVIEW_FIELDS = ("achieved", "pending", "next")
EXTENDED_FIELDS = ("execution", "process", "review")


class ArchiveError(Exception):
    """An intentionally redacted, safe-to-display failure."""


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def digest(value):
    return hashlib.sha256(value).hexdigest()


def uuid_value(value):
    if not isinstance(value, str):
        raise ArchiveError("Server returned an invalid record identifier.")
    try:
        parsed = uuid.UUID(value)
    except ValueError:
        raise ArchiveError("Server returned an invalid record identifier.") from None
    if str(parsed) != value.lower():
        raise ArchiveError("Server returned an invalid record identifier.")
    return str(parsed)


def identifier(value, *, optional=False):
    if optional and value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int)) or not re.fullmatch(r"[1-9][0-9]{0,18}", str(value)):
        raise ArchiveError("Customer and booking identifiers must be positive decimal IDs.")
    return str(value)


def endpoint_url(value):
    if not isinstance(value, str):
        raise ArchiveError("A trusted HTTPS Supabase endpoint is required.")
    try:
        parsed = urllib.parse.urlsplit(value)
        valid = (parsed.scheme == "https" and not parsed.username and not parsed.password
                 and bool(re.fullmatch(r"[a-z0-9-]+\.supabase\.co", parsed.hostname or ""))
                 and parsed.port in (None, 443)
                 and parsed.path == "/functions/v1/employee-bookings-api"
                 and not parsed.query and not parsed.fragment)
    except ValueError:
        valid = False
    if not valid:
        raise ArchiveError("Endpoint must be the trusted HTTPS Supabase employee-bookings-api URL.")
    return value


def signed_photo_url(value, endpoint):
    try:
        parsed, trusted = urllib.parse.urlsplit(value), urllib.parse.urlsplit(endpoint)
        valid = (parsed.scheme == "https" and parsed.hostname == trusted.hostname
                 and parsed.port in (None, 443) and not parsed.username and not parsed.password
                 and parsed.path.startswith("/storage/v1/object/sign/")
                 and bool(urllib.parse.parse_qs(parsed.query).get("token")) and not parsed.fragment)
    except (TypeError, ValueError):
        valid = False
    if not valid:
        raise ArchiveError("Server returned an untrusted original-photo download URL.")
    return value


def archive_url(value):
    if value in (None, ""):
        return ""
    try:
        parsed = urllib.parse.urlsplit(value)
        valid = (parsed.scheme == "https" and parsed.hostname == "chatgpt.com"
                 and parsed.port in (None, 443) and not parsed.username and not parsed.password
                 and bool(re.fullmatch(r"/space/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*", parsed.path))
                 and not parsed.query and not parsed.fragment)
    except (TypeError, ValueError):
        valid = False
    if not valid:
        raise ArchiveError("Archive links must be HTTPS chatgpt.com/space/ page URLs.")
    return urllib.parse.urlunsplit(("https", "chatgpt.com", parsed.path, "", ""))


def visit_key(config):
    expected = ("booking:" + identifier(config["booking_id"])) if config.get("booking_id") is not None else "manual:" + config["booking_date"]
    supplied = config.get("visit_key", expected)
    if not isinstance(supplied, str):
        raise ArchiveError("Visit key must match the explicitly selected service.")
    if supplied == expected:
        return supplied
    if config.get("booking_id") is None and supplied.startswith(expected + ":"):
        suffix = supplied[len(expected) + 1:]
        if uuid_value(suffix) == suffix:
            return supplied
    raise ArchiveError("Visit key must match the explicitly selected service.")


def private_path(value):
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise ArchiveError("Config must use an absolute path outside the repository.")
    # Resolve only the parent: resolving the final component would conceal a symlink.
    parent = path.parent.resolve()
    path = parent / path.name
    if path.is_relative_to(REPOSITORY):
        raise ArchiveError("Private configs and progress must stay outside the repository.")
    try:
        info = parent.stat()
    except OSError:
        raise ArchiveError("Create the config directory with mode 0700 first.") from None
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise ArchiveError("Config directory must be owned by the current user with mode 0700.")
    return path


def read_private(path):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1:
                raise ArchiveError("Config must be a regular, privately owned file, without links.")
            # Tighten the initial secret-free config before reading or adding secrets.
            os.fchmod(stream.fileno(), 0o600)
            data = stream.read(MAX_CONFIG_BYTES + 1)
    except OSError:
        raise ArchiveError("Cannot securely read the private config file.") from None
    if len(data) > MAX_CONFIG_BYTES:
        raise ArchiveError("Private config exceeds the supported size.")
    try:
        value = json.loads(data)
    except (UnicodeError, ValueError):
        raise ArchiveError("Config must be valid UTF-8 JSON.") from None
    if not isinstance(value, dict):
        raise ArchiveError("Config must contain a JSON object.")
    return value


def save_private(path, value):
    # Same-directory replace, fsync and private mode prevent half-written progress.
    temp_path = None
    try:
        fd, temp_path = tempfile.mkstemp(prefix=".archive-import-", dir=path.parent)
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(canonical(value) + b"\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_path, path)
        temp_path = None
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except OSError:
        raise ArchiveError("Cannot atomically save private import progress; stop before further writes.") from None
    finally:
        if temp_path is not None:
            with contextlib.suppress(OSError):
                os.unlink(temp_path)


@contextlib.contextmanager
def config_lock(path):
    try:
        fd = os.open(str(path) + ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1:
            os.close(fd)
            raise ArchiveError("Private import lock is unsafe.")
        os.fchmod(fd, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        if "fd" in locals():
            os.close(fd)
        raise ArchiveError("Another import is running, or the private lock is unavailable.") from None
    try:
        yield
    finally:
        os.close(fd)


def photo_bytes(photo):
    try:
        fd = os.open(photo["path"], os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode):
                raise ArchiveError("Original photo must be a regular file.")
            data = stream.read(MAX_PHOTO_BYTES + 1)
    except OSError:
        raise ArchiveError("An original photo cannot be read securely.") from None
    if not data or len(data) > MAX_PHOTO_BYTES:
        raise ArchiveError("Each original photo must contain 1 byte to 8 MiB.")
    if data.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    elif data.startswith(b"\x89PNG\r\n\x1a\n"):
        mime = "image/png"
    elif data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        mime = "image/webp"
    else:
        raise ArchiveError("Original photos must be JPEG, PNG or WebP files.")
    if photo.get("mime_type", mime) != mime:
        raise ArchiveError("Photo MIME type does not match the original file signature.")
    return data, mime


def model(value):
    if not isinstance(value, dict) or set(value) != {"outline", "root_flow", "steps"}:
        raise ArchiveError("Each design assessment needs outline, root_flow and eight structured steps.")
    steps = value.get("steps")
    if not isinstance(steps, dict) or set(steps) != set(STEPS):
        raise ArchiveError("Each design assessment must explicitly contain all eight step keys.")
    texts = [value["outline"], value["root_flow"], *steps.values()]
    if any(not isinstance(text, str) or len(text) > 4000 for text in texts):
        raise ArchiveError("Design fields must be text of at most 4000 characters.")
    return {"outline": value["outline"].strip(), "root_flow": value["root_flow"].strip(),
            "steps": {key: text.strip() for key, text in steps.items()}}


def normalized_reasons(value):
    return {key: value.get(key, "").strip() for key in FIELDS}


def text_document(value, keys, label):
    if not isinstance(value, dict) or set(value) - set(keys):
        raise ArchiveError(f"{label} must be an object using the supported field keys.")
    if any(not isinstance(text, str) or len(text) > 4000 for text in value.values()):
        raise ArchiveError(f"{label} fields must be text of at most 4000 characters.")
    result = {key: value.get(key, "").strip() for key in keys}
    return result if any(result.values()) else {}


def normalized_extended(version):
    """Keep empty legacy input empty; never change the prepared manifest itself."""
    execution = version.get("execution", {})
    if not isinstance(execution, dict) or set(execution) - set(ZONES):
        raise ArchiveError("Six-zone execution must be an object using the supported zone keys.")
    zones = {key: text_document(execution.get(key, {}), ZONE_FIELDS, "Six-zone execution") for key in ZONES}
    if any(zones.values()):
        zones = {key: {field: zones[key].get(field, "") for field in ZONE_FIELDS} for key in ZONES}
    else:
        zones = {}
    return {"execution": zones,
            "process": text_document(version.get("process", {}), PROCESS_FIELDS, "Ten-process reference"),
            "review": text_document(version.get("review", {}), REVIEW_FIELDS, "Completion review")}


def validate_config(config):
    if set(config) - {"endpoint", "customer_profile_id", "booking_id", "booking_date", "visit_key", "photos", "versions", "_import"}:
        raise ArchiveError("Config contains unsupported fields; do not add credentials or unrelated customer data.")
    endpoint_url(config.get("endpoint"))
    identifier(config.get("customer_profile_id"))
    identifier(config.get("booking_id"), optional=True)
    try:
        if dt.date.fromisoformat(config["booking_date"]).isoformat() != config["booking_date"]:
            raise ValueError
    except (KeyError, TypeError, ValueError):
        raise ArchiveError("booking_date must be an explicit ISO calendar date.") from None
    visit_key(config)
    photos = config.get("photos")
    versions = config.get("versions")
    if not isinstance(photos, list) or not 1 <= len(photos) <= 30:
        raise ArchiveError("Provide 1 to 30 existing original-photo files.")
    if not isinstance(versions, list) or not 1 <= len(versions) <= 20:
        raise ArchiveError("Provide 1 to 20 explicit saved design versions.")
    photo_meta = []
    for photo in photos:
        if not isinstance(photo, dict) or set(photo) - {"path", "stage", "angle", "caption", "mime_type"}:
            raise ArchiveError("Each original photo needs a local path, stage and angle.")
        if not isinstance(photo.get("path"), str) or not Path(photo["path"]).is_absolute():
            raise ArchiveError("Original photo paths must be absolute local paths.")
        if photo.get("stage") not in STAGES or photo.get("angle") not in ANGLES:
            raise ArchiveError("Original photo stage or angle is invalid.")
        if not isinstance(photo.get("caption", ""), str) or len(photo.get("caption", "")) > 500:
            raise ArchiveError("Photo captions must contain at most 500 text characters.")
        data, mime = photo_bytes(photo)
        photo_meta.append({"sha256": digest(data), "byte_size": len(data), "mime_type": mime})
    for version in versions:
        if not isinstance(version, dict) or set(version) - {"status", "baseline", "optimized", "reasons", "photo_indices", "archive_url", *EXTENDED_FIELDS}:
            raise ArchiveError("Version contains unsupported fields.")
        if version.get("status") not in STATUSES:
            raise ArchiveError("Each saved version requires a supported explicit status.")
        archive_url(version.get("archive_url"))
        baseline, optimized = model(version.get("baseline")), model(version.get("optimized"))
        normalized_extended(version)
        reasons = version.get("reasons")
        if not isinstance(reasons, dict) or set(reasons) - set(FIELDS) or any(not isinstance(v, str) or len(v) > 4000 for v in reasons.values()):
            raise ArchiveError("Adjustment reasons must use the outline/root_flow/eight-step field keys.")
        for key in FIELDS:
            before = baseline[key] if key in ("outline", "root_flow") else baseline["steps"][key]
            after = optimized[key] if key in ("outline", "root_flow") else optimized["steps"][key]
            if after.strip() and after.strip() != before.strip() and not reasons.get(key, "").strip():
                raise ArchiveError("Every changed design field requires an explicit adjustment reason.")
        indices = version.get("photo_indices", list(range(len(photos))))
        if not isinstance(indices, list) or not indices or len(set(indices)) != len(indices) or any(type(i) is not int or not 0 <= i < len(photos) for i in indices):
            raise ArchiveError("Version photo_indices must refer to distinct existing original photos.")
    # Bind every request UUID to the exact immutable local contents and design input.
    manifest = {key: value for key, value in config.items() if key != "_import"}
    return digest(canonical({"config": manifest, "originals": photo_meta})), photo_meta


def validate_progress(config, manifest_sha256, photo_meta):
    progress = config.get("_import")
    if not isinstance(progress, dict) or progress.get("schema_version") != 1:
        raise ArchiveError("Run prepare first to create private, resumable request IDs.")
    if progress.get("manifest_sha256") != manifest_sha256:
        raise ArchiveError("Prepared originals or design input changed; use a new config for new work.")
    token = progress.get("ingest_token")
    if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9_-]{64}", token):
        raise ArchiveError("Private ingest token is missing or invalid; run prepare.")
    if len(progress.get("photos", [])) != len(photo_meta) or len(progress.get("versions", [])) != len(config["versions"]):
        raise ArchiveError("Persisted import progress is invalid.")
    for state, meta in zip(progress["photos"], photo_meta):
        uuid_value(state.get("request_id"))
        if any(state.get(key) != val for key, val in meta.items()):
            raise ArchiveError("Persisted original-photo digest does not match local bytes.")
        if state.get("asset_id"):
            uuid_value(state["asset_id"])
    for state in progress["versions"]:
        uuid_value(state.get("request_id"))
        if state.get("version_id"):
            uuid_value(state["version_id"])
        if state.get("expected_latest_version_id"):
            uuid_value(state["expected_latest_version_id"])
    return progress


def prepare(path, rotate_token=False):
    config = read_private(path)
    manifest_sha256, photo_meta = validate_config(config)
    if "_import" in config:
        progress = validate_progress(config, manifest_sha256, photo_meta)
        if rotate_token:
            progress["ingest_token"] = secrets.token_urlsafe(48)
    else:
        progress = {"schema_version": 1, "manifest_sha256": manifest_sha256,
                    "ingest_token": secrets.token_urlsafe(48),
                    "photos": [{**meta, "request_id": str(uuid.uuid4())} for meta in photo_meta],
                    "versions": [{"request_id": str(uuid.uuid4())} for _ in config["versions"]]}
        config["_import"] = progress
    save_private(path, config)
    result = {"token_sha256": digest(progress["ingest_token"].encode("ascii")),
              "customer_profile_id": identifier(config["customer_profile_id"]),
              "booking_id": identifier(config.get("booking_id"), optional=True),
              "booking_date": config["booking_date"]}
    if "visit_key" in config:
        result["visit_key"] = visit_key(config)
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Transport:
    def __init__(self):
        # Preserve the cloud's proxy settings and managed CA trust; never disable TLS.
        ca_file = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
        self.opener = urllib.request.build_opener(
            NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=ca_file)))

    def _read(self, request, limit):
        try:
            with self.opener.open(request, timeout=60) as response:
                body = response.read(limit + 1)
        except urllib.error.HTTPError as error:
            raise ArchiveError(f"Remote request failed (HTTP {error.code}); private response omitted. Re-run unchanged config after resolving it.") from None
        except (OSError, urllib.error.URLError, ValueError):
            raise ArchiveError("Remote request did not complete. Re-run the unchanged config; persisted request IDs prevent duplicate writes.") from None
        if len(body) > limit:
            raise ArchiveError("Remote response exceeds the supported size; private response omitted.")
        return body

    def post(self, endpoint, payload):
        request = urllib.request.Request(endpoint, data=canonical(payload), method="POST", headers={"Content-Type": "application/json", "Accept": "application/json"})
        body = self._read(request, MAX_RESPONSE_BYTES)
        try:
            result = json.loads(body)
        except (ValueError, UnicodeError):
            raise ArchiveError("Remote service returned an invalid JSON response; private content omitted.") from None
        if not isinstance(result, dict) or result.get("error") or result.get("ok") is False:
            raise ArchiveError("Remote service rejected the request; private response omitted. Check the grant scope/expiry and current design version.")
        return result

    def download(self, url):
        # The signed URL is already scoped; do not attach ingest or employee tokens.
        return self._read(urllib.request.Request(url, headers={"Accept": "image/*"}), MAX_PHOTO_BYTES)


class ImportRunner:
    def __init__(self, path, transport=None):
        self.path = path
        self.config = read_private(path)
        manifest_sha256, photo_meta = validate_config(self.config)
        self.progress = validate_progress(self.config, manifest_sha256, photo_meta)
        self.transport = transport if transport is not None else Transport()

    def persist(self):
        save_private(self.path, self.config)

    def call(self, operation, **fields):
        payload = {"operation": operation, "ingest_token": self.progress["ingest_token"],
                   "customer_profile_id": self.config["customer_profile_id"],
                   "booking_date": self.config["booking_date"], **fields}
        if self.config.get("booking_id") is not None:
            payload["booking_id"] = self.config["booking_id"]
        if self.config.get("visit_key") is not None:
            payload["visit_key"] = self.config["visit_key"]
        return self.transport.post(self.config["endpoint"], payload)

    def history(self):
        result = self.call("customer_design_history")
        if identifier(result.get("customer_profile_id")) != identifier(self.config["customer_profile_id"]):
            raise ArchiveError("Server history did not match the explicitly selected customer.")
        if self.config.get("booking_id") is not None and identifier(result.get("booking_id")) != identifier(self.config["booking_id"]):
            raise ArchiveError("Server history did not match the explicitly selected booking.")
        if not isinstance(result.get("versions"), list):
            raise ArchiveError("Server history returned an invalid version list.")
        if result.get("latest_version_id") is not None:
            uuid_value(result["latest_version_id"])
        return result

    def verify_record_scope(self, record):
        if identifier(record.get("customer_profile_id")) != identifier(self.config["customer_profile_id"]):
            raise ArchiveError("Saved record did not match the explicitly selected customer.")
        if identifier(record.get("booking_id"), optional=True) != identifier(self.config.get("booking_id"), optional=True):
            raise ArchiveError("Saved record did not match the explicitly selected booking.")
        if record.get("booking_date") != self.config["booking_date"]:
            raise ArchiveError("Saved record did not match the explicitly selected service date.")
        if record.get("visit_key") != visit_key(self.config):
            raise ArchiveError("Saved record did not match the explicitly selected visit.")

    def upload(self, index):
        state, photo = self.progress["photos"][index], self.config["photos"][index]
        if state.get("asset_id"):
            return
        data, mime = photo_bytes(photo)
        if digest(data) != state["sha256"]:
            raise ArchiveError("Original photo bytes changed after preparation; upload stopped.")
        extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[mime]
        result = self.call("customer_design_upload", request_id=state["request_id"],
                           data_base64=base64.b64encode(data).decode("ascii"), mime_type=mime,
                           filename="original" + extension, stage=photo["stage"], angle=photo["angle"],
                           caption=photo.get("caption", "").strip(), sha256=state["sha256"])
        asset = result.get("asset")
        if not isinstance(asset, dict) or asset.get("sha256") != state["sha256"] or asset.get("byte_size") != state["byte_size"]:
            raise ArchiveError("Uploaded original digest or byte count did not match; import stopped.")
        self.verify_record_scope(asset)
        if asset.get("stage") != photo["stage"] or asset.get("angle") != photo["angle"]:
            raise ArchiveError("Uploaded original photo stage or angle did not match the selected view.")
        if asset.get("caption", "") != photo.get("caption", "").strip():
            raise ArchiveError("Uploaded original photo caption did not match the selected view.")
        state["asset_id"] = uuid_value(asset.get("id"))
        state["metadata_verified"] = True
        self.persist()

    def verify_version(self, actual, expected, photo_ids):
        if not isinstance(actual, dict):
            raise ArchiveError("Server did not return the saved immutable design version.")
        self.verify_record_scope(actual)
        version_id = uuid_value(actual.get("id"))
        if actual.get("source") != "chatgpt" or actual.get("status") != expected["status"]:
            raise ArchiveError("Saved version source or status did not match the authorized import.")
        for key in ("baseline", "optimized", "reasons"):
            content = normalized_reasons(expected[key]) if key == "reasons" else model(expected[key])
            if actual.get(key) != content:
                raise ArchiveError("Saved eight-step design content did not match; import stopped.")
        for key, content in normalized_extended(expected).items():
            if actual.get(key, {}) != content:
                raise ArchiveError("Saved six-zone execution, process or completion review did not match; import stopped.")
        if archive_url(actual.get("archive_url")) != archive_url(expected.get("archive_url")):
            raise ArchiveError("Saved version did not retain the selected ChatGPT archive link.")
        assets = actual.get("photos")
        if not isinstance(assets, list) or {a.get("id") for a in assets if isinstance(a, dict)} != set(photo_ids):
            raise ArchiveError("Saved version did not reference the selected original photos.")
        local_assets = {p["asset_id"]: {**p, **self.config["photos"][i]}
                        for i, p in enumerate(self.progress["photos"]) if p.get("asset_id")}
        for asset in assets:
            self.verify_record_scope(asset)
            local = local_assets[asset["id"]]
            if asset.get("sha256") != local["sha256"] or asset.get("byte_size") != local["byte_size"]:
                raise ArchiveError("Saved version original-photo digest did not match local bytes.")
            if asset.get("stage") != local["stage"] or asset.get("angle") != local["angle"]:
                raise ArchiveError("Saved version original photo stage or angle did not match the selected view.")
            if asset.get("caption", "") != local.get("caption", "").strip():
                raise ArchiveError("Saved version original photo caption did not match the selected view.")
        return version_id

    def run(self, verify_originals=False):
        history = self.history()
        for index in range(len(self.config["photos"])):
            self.upload(index)
        latest = history.get("latest_version_id")
        for state, version in zip(self.progress["versions"], self.config["versions"]):
            photo_ids = [self.progress["photos"][i]["asset_id"] for i in version.get("photo_indices", range(len(self.config["photos"])))]
            if state.get("version_id"):
                latest = state["version_id"]
                continue
            # Persist the concurrency precondition BEFORE sending the write. A lost
            # reply must replay the same request, never adopt a new expected version.
            if "expected_latest_version_id" not in state:
                state["expected_latest_version_id"] = latest
                self.persist()
            # Only absent additions are omitted, preserving old prepared writes
            # exactly. An explicit {} is an intentional empty snapshot, including
            # an explicitly requested clear of previously saved content.
            extended = {key: value for key, value in normalized_extended(version).items() if key in version}
            result = self.call("customer_design_save", request_id=state["request_id"],
                               expected_latest_version_id=state["expected_latest_version_id"],
                               status=version["status"], baseline=model(version["baseline"]), optimized=model(version["optimized"]),
                               reasons=normalized_reasons(version["reasons"]), photo_ids=photo_ids,
                               archive_url=archive_url(version.get("archive_url")), **extended)
            actual = result.get("version")
            state["version_id"] = self.verify_version(actual, version, photo_ids)
            latest = state["version_id"]
            self.persist()
        # Read-back ensures successful replies did not merely echo an unsaved body.
        saved = {v.get("id"): v for v in self.history()["versions"] if isinstance(v, dict)}
        for state, version in zip(self.progress["versions"], self.config["versions"]):
            ids = [self.progress["photos"][i]["asset_id"] for i in version.get("photo_indices", range(len(self.config["photos"])))]
            self.verify_version(saved.get(state["version_id"]), version, ids)
        if verify_originals:
            self.verify_originals()
        return {"photos_saved": len(self.progress["photos"]), "versions_saved": len(self.progress["versions"]),
                "asset_sha256_verified": sum(bool(p.get("metadata_verified")) for p in self.progress["photos"]),
                "download_sha256_verified": sum(bool(p.get("original_verified")) for p in self.progress["photos"]),
                "asset_ids": [p["asset_id"] for p in self.progress["photos"]],
                "version_ids": [v["version_id"] for v in self.progress["versions"]]}

    def verify_originals(self):
        pending = [p for p in self.progress["photos"] if not p.get("original_verified")]
        if not pending:
            return
        result = self.call("customer_design_photo_urls", asset_ids=[p["asset_id"] for p in pending])
        assets = result.get("assets")
        if not isinstance(assets, list):
            raise ArchiveError("Server returned an invalid original-photo URL list.")
        urls = {a.get("id"): a.get("url") for a in assets if isinstance(a, dict)}
        for state in pending:
            url = signed_photo_url(urls.get(state["asset_id"]), self.config["endpoint"])
            data = self.transport.download(url)
            if digest(data) != state["sha256"] or len(data) != state["byte_size"]:
                raise ArchiveError("Downloaded original photo differs from the original local bytes.")
            state["original_verified"] = True
            self.persist()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("prepare", "import"):
        sub = commands.add_parser(command)
        sub.add_argument("--config", required=True, help="Absolute private JSON path outside the repository; parent mode 0700")
        if command == "prepare":
            sub.add_argument("--rotate-token", action="store_true", help="Replace only the ingest token for a new scoped short-lived grant; preserve request IDs")
        else:
            sub.add_argument("--verify-originals", action="store_true", help="Also download signed private originals and verify exact SHA-256 bytes")
    args = parser.parse_args(argv)
    try:
        path = private_path(args.config)
        with config_lock(path):
            result = prepare(path, args.rotate_token) if args.command == "prepare" else ImportRunner(path).run(args.verify_originals)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    except ArchiveError as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('{"error":"Import interrupted; re-run the unchanged config to resume safely."}', file=sys.stderr)
        return 130
    except Exception:
        # No traceback, local paths, bearer token, signed URL or customer text.
        print('{"error":"Unexpected local import failure; private details omitted."}', file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
