# Local server continuation — 2026-11-17

Stage42 update: [PHONE-BACKEND-DELIVERY.md](PHONE-BACKEND-DELIVERY.md) supersedes
this initial handoff's phone-format, broker and local durable-storage gaps.
HEIC/HEIF now have an actual isolated codec path and mTLS broker. Models are a
separate explicit switch, default false; non-model operation needs no API key.
The original ImageMagick/synthetic qualifications described below stay intact.

This is an isolated local development delivery, not a production release or real
AI acceptance. No module reads a default environment credential, opens a listener
on import, issues an approval, installs SQL or starts a worker host. The original
employee homepage, manual selection/confirmation and append-only archive remain.

## Concrete additions

- `node-http-server.mjs`: explicit loopback-only Node listener for the existing
  Fetch handler. Fixed API prefix, POST/origin checks, allowlisted request and
  response headers, 12 MiB request/64 MiB response ceilings, <=30 s deadline and
  bounded admission. Unresolved timed-out work retains its slot; closing reports
  unresolved handlers. No static files, proxy URL, SQL or approval issuer route.
- `server-secret-files.mjs`: server-only binary 32-byte master key from a
  canonical owner-only 0700 directory and 0600 regular file. Refuses symlinks,
  hardlinks, shared permissions, unsupported purposes and wrong sizes. Existing
  AES-GCM v2 encryption and immutable employee AAD are reused. No plaintext model
  key goes in config JSON, browser storage, source, logs or archives.
- `scoped-private-media-transport.mjs`: actual injected-fetch Supabase private
  object I/O for the original media lane. Fixed bucket/path, create-only writes,
  authenticated reads, short-lived authenticated JWT + publishable API key,
  fresh external authorizer before credentials/before I/O/after I/O, bounded
  response/deadline and no redirects/retries. JWT parsing only rejects obvious
  bypass credentials; Supabase verifies signatures and RLS must actually exist.
  The storage abstraction's logical GET URL maps to the authenticated wire URL;
  the exact wire response URL is checked before returning the logical URL.
- `phone-photo-processing.mjs`: separate general-photo processing contract and
  independent full decode of the tiny RGBA PNG reconstructed by the existing
  isolated worker. Checks CRC, exact dimensions, allowed chunks, pixel bytes and
  complete zlib input consumption. Binds source digest and fresh processing
  checks; denies late/revoked output. It never creates synthetic task evidence,
  model/cost approval, adoption, employee confirmation or public eligibility.
- `configured-server-runtime.mjs`: explicit composition of the original real
  media/workflow/candidate/immutable-key services, approved server model lists,
  private transport, encryption and independent derivative inspector. All
  dependencies are trusted server capabilities. Synthetic application routes and
  speech stay closed. Missing config/key dependencies fail before listener start.

## Phone support and limitations

The general worker accepts bounded static JPEG/PNG/WebP containers, <=8 MiB,
<=16384 pixels per axis and <=40 million pixels. Unsupported HEIC/HEIF, video,
animation, malformed/truncated/trailing containers fail; there is no host decoder
fallback. EXIF orientation is applied by the native worker before stripping and
fresh PNG construction. Metadata removal is not anonymization.

Its conservative derivative is <=128 pixels per axis. That is sufficient for
bounded protocol verification, not proof of useful hair detail or model accuracy.
The independent decoder verifies derivative pixels, not arbitrary JPEG/WebP
entropy consumption or the security of a caller-supplied worker implementation.
The Mac still cannot satisfy `createIsolatedPrivateImageWorker`'s actual Linux,
nonroot, rootless/systemd/cgroup checks. No check was weakened. A qualified host,
reviewed immutable native image and authenticated broker remain external gates.

The configured runtime wires this general worker through the pre-existing native
media/candidate routes, with the original processing/cost/attempt ledger. It does
not expand the Stage40/41 fixed synthetic qualification or rewrite old history.
`worker.inspect`/`worker.derive` must come from the reviewed isolated worker or a
separately qualified authenticated service; arbitrary callbacks are not security
attestations. The standalone phone processor is an additional boundary, not an
automatic replacement for the media repository's own current authorization.

## Local integration shape (not a configured deployment)

```js
const runtime = await createConfiguredDesignServerRuntime({
  enabled: false,                 // only change after dependency acceptance
  publicOrigin: 'https://design.example.invalid',
  secretDirectory: '/absolute/private/server-secrets',
  modelConfig: {approved: true, model: 'REVIEWED_MODEL', maxTokens: 1024},
  approvedVisionModels: ['REVIEWED_MODEL'],
  approvedTextModels: ['REVIEWED_MODEL'],
  acquireClient,                  // existing restricted pg driver, not superuser
  worker,                        // independently provisioned broker capability
  mediaApprovalVerifier,         // independent current immutable approvals
  storageOrigin, storageAuthorize, storageCredentialProvider,
  fetchImplementation,           // explicitly provisioned server transport
});
// Explicit second activation; importing either module starts nothing.
const server = await startDesignNodeServer({
  enabled: false, runtime, publicOrigin: 'https://design.example.invalid',
});
```

The service binds only 127.0.0.1. A separately configured TLS reverse proxy must
route the existing employee site's `/api/design/*` to it without changing Origin
or relying on client Forwarded headers. GitHub Pages alone cannot provide that
backend. Do not put a Docker socket in this web service: the native worker belongs
on its separate host/service identity. No broker IPC implementation is supplied
by the trusted `worker` argument; provisioning one is still required.

Provision the master key locally in a server secret manager or protected binary
file outside the source/release/evidence tree; never send it in chat. The existing
authenticated `/api/design/key-settings/{read,save,revoke}` APIs store each
employee's model key encrypted after independent approval. They do not approve
image processing or costs. No public settings form was added. Use an approved
secure administrative client for those APIs only after TLS, identity, revisions
and approval issuance are installed. Never use browser persistent storage.
Back up the encryption key separately: replacing it without a versioned migration
will make existing encrypted employee keys unreadable. No automatic hot rotation.

The private bucket must be nonpublic with deployed scoped INSERT/SELECT policies;
no service-role/bypass key or UPDATE/DELETE policy is provisioned here. Restore,
retention/deletion, backup and forward rollback need actual target acceptance.
No database URL, runtime grants, issuer grants or credentials are packaged.

## 30-second UI repair

The initial complete browser run failed its unchanged 30 s total UI assertion:
the compare call and subsequent candidate load were sequential. Status v2 can
now include the same bounded review DTO obtained from the freshly published row.
The repository moves its existing current candidate read to the transaction's
before-commit hook and requires equality with the published row; existing final authority,
bundle, source and HTTP authentication checks remain. No cross-request authority
cache or private evidence is returned. Status v1 and independent load continue
to work. The controller applies the same scope/session/revision/task/source
checks to inline reviews. Unknown outcomes still query the original request ID.

The browser harness changes only its observation of the new inline review DTO;
timeouts, 30 s assertions, separate employee confirmation and privacy assertions
are unchanged. Consult the final acceptance report for measured pass/fail.

## Reproduction and boundaries

Use Node 22.22.1 and `npm ci --offline --ignore-scripts --no-audit --no-fund` when
the locked packages are cached. Do not borrow or mutate another worktree's deps.

```sh
npm run test:design-local-pure -- --evidence-dir /absolute/new/evidence/pure
npm run test:design-local-server
npm run test:design-local-server-http
node scripts/test-design-private-image-worker.mjs
node scripts/test-design-application-views-runtime-postgres.mjs --actual-worker
node scripts/test-design-application-views-http-browser.mjs
```

Heavy PG and browser suites run sequentially, only with synthetic data, existing
pinned images and unique local fixture resources. The finite pure manifest lists
excluded PG/browser/native suites explicitly. These suites do not certify all
historical tests, omitted non-design repository content or production readiness.
An ordinary protocol-only PG run or `--smoke` does not replace `--actual-worker`.
Keep a failed performance run as evidence; never raise the budget to pass.
The older PG/browser harnesses still contain task-scoped absolute evidence paths.
Before running from another extraction, relocate those evidence paths to that
new task first, preserving limits, permissions and assertions.

The handoff omitted four fixture SQL prerequisites. They were restored read-only
from baseline `c0c061c8`, with source commit and hashes recorded in delivery
evidence. Existing old evidence paths were redirected only in this isolated copy.
The original ZIP and original/previous development trees were not changed.

This source subset has no Git history and lacks some publication governance
files. Its v691 label is inherited, not a new production release. The task's
explicit no-push/no-deploy scope supersedes repository push instructions here.
Integrate the reviewed diff into the then-current full repository and assign its
forward release version only under a later authorized release process.

## Official interfaces checked on 2026-11-17

- https://nodejs.org/docs/latest-v22.x/api/fs.html
- https://nodejs.org/api/http.html
- https://supabase.com/changelog.md
- https://supabase.com/docs/guides/storage/serving/downloads
- https://supabase.com/docs/guides/storage/security/access-control
- https://api-docs.deepseek.com/quick_start/pricing/

These document interfaces, not deployed permissions or real model acceptance.
DeepSeek's current model table lists vision for Flash and not V4 Pro. No model is
selected or enabled by this delivery. Verify supported request/image constraints,
region, prices and limits again when the user configures an actual service.
