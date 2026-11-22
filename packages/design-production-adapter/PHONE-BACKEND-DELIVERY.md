# Phone photos and private backend — local acceptance, 2026-11-17

This continuation is an unpublished change to the isolated source snapshot.
Production, appointment synchronization, real identities/photos and paid APIs
were not accessed. `modelsEnabled` now defaults to **false**, independently of
the original media/workflow backend. No model key is required for these tests.

## What is implemented

The existing employee entry/file picker, workflow, review and full archive are
reused. Explicit `allowPhonePhotos:true` enables JPEG/PNG/WebP/**HEIC/HEIF**;
HEIF selection is marked pending server decode, never falsely browser-decoded.
Selection does not upload. An employee separately uploads, attaches, previews,
records observations, confirms and saves the full archive. Before/after pairs
are shown for the angles actually attached; no AI comparison is invented.
Processing admission prevents an upload from colliding with a pending preview.

`phone-native-worker.py` fully decodes static sources in the pinned Pillow13 /
pillow-heif1.8.1 native image. HEIF is real HEVC/libheif decoding, including a
synthetic 10-bit source, not a renamed JPEG or fixture whitelist. EXIF JPEG/WebP
and HEIF container rotation are applied once and tested with colored pixel
markers. A fresh JPEG <=1024 pixels/512KiB is decoded again in a second container
and checked for metadata absence. A <=108px RGBA PNG preserves the existing
candidate protocol limit; it is not evidence of useful hair-detail accuracy.
Every JPEG warning is fatal through a small libjpeg validator: an early EOI
inserted into truncated entropy is rejected. All PNG chunk CRCs are checked,
including IEND. Animation, multipage HEIF, bad framing, trailing bytes, oversized
input and malformed/truncated examples are denied.

Input ceiling: 8MiB, 40 million pixels, 16384 per axis, one frame. Each actual job
is created and inspected before receiving bytes: no network, host mounts, ports,
devices, environment secrets or Docker socket; nonroot UID65532, read-only root,
capabilities dropped, no-new-privileges, 1CPU, 1GiB, 32PIDs and private tmpfs.
The process additionally uses memory/CPU/file/FD limits. Cleanup targets its exact
UUID container. Cleanup uncertainty quarantines that worker instance.

`phone-image-broker.mjs` supplies actual bounded HTTPS mutual TLS, exact client
and server certificate pins, a fixed three-operation binary protocol, source
digest binding, single admission and deadlines. The web service receives only
the broker client capability. It does not receive a Docker capability. The
broker currently binds loopback, suitable for separate local process identities;
cross-host routing/TLS and operational identity provisioning remain deployment
work. No listener starts on import. A Docker image is not a host-security audit.

`encrypted-private-media-transport.mjs` supplies durable private **local files**,
not a mock object map. AES-256-GCM binds each source to its exact logical URI;
HKDF separates its key domain. Directories/files must be owner-only 0700/0600.
Create-only fsync + atomic link publication refuses overwrite; reads verify tag,
digest and metadata. A narrowly matched interrupted staging hardlink can be
recovered. Unknown write outcomes use the original request ID/readback. Current
application identity, source access and independent upload/view receipts remain
required; preview reads again after normalization before returning bytes.

The existing `.supabase.co` URI is only the original media abstraction's AAD
namespace in this local transport. **No Supabase cloud object request is sent.**
The existing scoped authenticated cloud transport remains available, separately
configured; cloud bucket/RLS/JWT/backup acceptance has not been performed.
Local create-only storage is not WORM against the host administrator.

## Composition without model keys

```js
// All values are trusted server capabilities, never HTTP input or browser state.
const privateMediaTransport = createEncryptedPrivateMediaTransport({
  enabled: true, root: privateDirectory, origin: storageOrigin,
  secretProvider: protectedFileSecretProvider, authorize: currentStorageAuthority,
});
const worker = createPhoneImageBrokerClient({
  enabled: true, endpoint: reviewedInternalTLSOrigin,
  tls: serverOnlyClientCertificate, serverFingerprint: reviewedBrokerPin,
});
const runtime = await createConfiguredDesignServerRuntime({
  enabled: true, modelsEnabled: false, publicOrigin,
  acquireClient: restrictedPostgresClient,
  worker, mediaApprovalVerifier: independentCurrentReceiptVerifier,
  storageOrigin, privateMediaTransport,
});
const listener = await startDesignNodeServer({
  enabled: true, runtime, publicOrigin, // binds 127.0.0.1 only
});
// Explicit existing homepage bridge config: allowUploads:true,
// allowPhonePhotos:true, allowBrowserViews:true, previews:{enabled:true}.
```

The private object encryption master is separate from a model API key. Provision
32 random bytes server-side in the protected file/secret manager, outside source,
release, screenshots and chat. Keep an encrypted separate backup; no automatic
key rotation is implemented. Models/key-settings/speech and synthetic model lanes
remain closed in this composition. Later API-key setup alone does not grant
photo processing, external transmission, costs, employee confirmation or publish
eligibility. Keep `modelsEnabled:false` until that separate acceptance is done.

## Reproduction

Use the extracted snapshot's locked Node22 dependencies; no system install is
needed. The builder supports the pinned Linux/arm64 image only. Docker and its
pinned base image must already exist; it does not start OrbStack or alter other
containers. Supply absolute private work/cache paths, outside the source tree.

```sh
node scripts/build-design-phone-worker.mjs \
  --work-root /absolute/own/test-work --wheel-dir /absolute/own/wheel-cache \
  --tag design-phone-worker:local-phone-test --download --corpus
node scripts/test-design-phone-native-actual.mjs --work-root /absolute/own/test-work
node scripts/test-design-phone-image-broker.mjs --work-root /absolute/own/test-work
node scripts/test-design-phone-backend-browser.mjs --work-root /absolute/own/test-work
npm run test:design-local-pure -- --evidence-dir /absolute/own/pure-evidence
npm run test:design-local-server-http
```

`--download` explicitly allows only the fixed official wheel URLs and SHA256
hashes in `phone-worker-lock.json`; omit it when cached. The Docker build itself
uses no network. Vendored libjpeg headers are unmodified official3.1.3 files
with hashes and licenses. The C validator links the exact Pillow wheel's ABI62
library. This software is based in part on the work of the Independent JPEG
Group. Pillow/pillow-heif and native libraries retain their bundled licenses in
the wheel/image. The image includes runtime files from the pinned base; it has
not been certified minimal or production hardened.

The browser test creates one unique **network-none synthetic PG17 fixture**, a
restricted real node-postgres runtime driver, encrypted files, ephemeral mTLS
certificates, local listeners and real codec jobs. It seeds **zero** model keys.
Only synthetic identity/photos and the finite independent receipt issuer are
test fixtures. That issuer is not a production authorization service. The SQL
installer uses existing drafts plus Stage37 browser archive prerequisites and
one narrowly anchored Stage42 HEIF MIME grammar patch; exact source deltas,
function owners and ACLs are asserted. Never run fixture SQL on production.

## Acceptance limits

The Mac uses the explicitly named offline qualification coordinator. The
production factory still refuses this Mac and requires actual Linux/nonroot/
rootless/systemd/cgroup checks; no platform assertion flag bypass was added.
Target worker host, independent identity/receipt provisioning, production SQL
migrations, cloud permissions, TLS ingress, retention/deletion and operational
backup/key recovery need their own acceptance before a later release.

Tests include generated 12MP pixel markers and high-entropy sources (6,822,693-byte
JPEG and 8,049,698-byte HEIC, both below 8MiB), not a physical iPhone session or customer
photo. 10-bit input is reduced to an 8-bit preview; calibrated HDR/color fidelity,
real-device capture variations, hair detail/model accuracy and paid calls are
not accepted by these tests. Metadata stripping is not face anonymization. The
delivery preserves old source/history hashes, synthetic-only worker gates and
the original 30-second assertions. Nothing is pushed or deployed.
