# Independent design HTTPS ingress — candidate, not installed

The owner authorized progressing through publication on November18. This removes
the earlier no-push/deployment restriction for this feature; it does not waive
release gates or authorize changes to appointment synchronization. Models stay
off. No actual isolated server address, site authority/bootstrap or provisioned
TLS identity has been supplied. Do not infer a target from synthetic fixtures.

`design-staging.Caddyfile` is a concrete Caddy **2.11.9** ingress candidate for a
separate site on the same host as the existing loopback design listener. Static
browser assets and `/api/design/*` have one HTTPS origin. It does not add an API
route to GitHub Pages or enable the current business homepage. The independent
prepared page still opens closed; real login/session/receipt issuance and a
reviewed host bridge must be provided before actual staff can use it.

## Operator configuration and installation boundary

Use a dedicated, reviewed public directory containing **only** the 24 paths in
`design-public-files.json`, copied from the accepted immutable release. Verify
every source hash, owner and absence of symlinks. Never serve the checkout root.
There is no directory browsing or fallback to arbitrary repository files. Do not
copy fixtures, draft SQL, adapter modules, private bootstrap, keys, dumps or
objects into this directory. The Caddy account needs read access to this separate
public tree and its own provisioned certificate/key, never the media master,
image broker private key or Docker socket.

Supply these operator-controlled environment variables in a protected service
configuration, not in the public repository or browser:

| Variable | Required meaning |
| --- | --- |
| `DESIGN_HTTPS_ORIGIN` | Exact HTTPS site origin, equal to the backend `publicOrigin` |
| `DESIGN_BIND_ADDRESS` | Explicit interface belonging to this independent site |
| `DESIGN_BACKEND_PORT` | Existing readiness-checked design listener on 127.0.0.1 |
| `DESIGN_PUBLIC_DIRECTORY` | Absolute dedicated 24-file public tree |
| `DESIGN_TLS_CERT` | Absolute reviewed PEM chain for the actual hostname |
| `DESIGN_TLS_KEY` | Absolute owner-protected PEM key for that chain |

Run the fixed-version `caddy validate --config deployment/design-staging.Caddyfile
--adapter caddyfile` before starting a separate service. Missing variables fail
validation; syntactic validation does not prove isolation or authority. This
delivery installs no supervisor, changes no DNS/firewall, opens no public port
and obtains no certificate. Automatic HTTPS, the admin API, persisted config and
HTTP redirection are off. Certificate renewal/reload and expiry alerting remain
operator work that must be tested on the actual host. TLS1.3-only support is the
current acceptance policy; physical-device compatibility is still pending.

Keep the Node listener and broker independently bound to loopback. Run the image
host preflight and enforcement negatives on the real Linux arm64/rootless/cgroup
host; this Mac cannot qualify it. Start no public listener before restricted DB
roles/schema, independent identity/receipts, private object/key permissions and
broker readiness have passed. Test fixture SQL is **not** a deployment migration.
See the adapter's `STAGING-OPERATIONS.md` and its recovery runbooks.

## Transport rules

The ingress accepts exact raw POST paths (no encoded/query aliases) with the
actual exact Origin. It preserves that Origin, the employee-session header and
request body; it does not manufacture or translate employee authorization. The
backend repeats every authorization check. No CORS response is added. A single
upstream attempt, disabled keepalive and removed idempotency headers prevent
proxy replay of uncertain writes. The 12MiB request limit matches the backend;
streaming over-limit bodies may already have reached it, so backend limits remain
mandatory. A disconnect/502 never proves an upload did not commit. Keep the same
request ID and use explicit authorized readback/recovery.

Do not buffer whole uploads at ingress. Keep the original Node30s processing
deadline; ingress35s write deadline only allows delivery/closing overhead. Static
responses default to no-store. Backend `private, no-store` preview headers must
survive: replacing them with generic no-store caused the first full browser
acceptance to fail. Do not loosen the client's private-response requirement.
Cookie, ambient authorization, redirects and upstream CORS grants are withheld.
Static CSP allows same-origin scripts/connections and blob images only. Camera,
microphone and geolocation remain off for this non-model entry.

No access log is enabled. The default runtime logger removes the whole request
object, including the custom employee session header, on failures. Lifecycle and
fixed status/error evidence remain; production privacy/monitoring retention is
still unaccepted. Do not enable unfiltered debug/access logs to diagnose staff
requests. Test that failure logs contain no synthetic credential before rollout.

## Repeatable local acceptance

The standalone `scripts/test-design-https-ingress.mjs` needs an absolute task-local
Caddy2.11.9 binary and `--work-root` directory. It starts actual TLS1.3 sockets,
verifies the ephemeral CA and hostname, rejects an untrusted CA, tests the exact
24-file allowlist/MIME, Origin/method/raw path denials, private cache preservation,
header stripping, single-attempt disconnect, upload size and log redaction. All
certificates/keys/listeners are removed by exact fixture ownership.

The existing full test now also accepts:

```text
node scripts/test-design-phone-backend-browser.mjs --https-ingress \
  --full-recovery --stream-recovery --caddy /absolute/task-local/caddy \
  --work-root /absolute/isolated/test-corpus-directory
```

This mode uses native browser fetch over actual Caddy HTTPS. There is **no browser
request interception, fetch replacement or response-URL fabrication**. It keeps
the original employee-homepage DOM/session-bridge slice, injected synthetic staff
and finite receipt issuer; it is not real login or a full production homepage.
A local HTTP fault relay deliberately loses one upload acknowledgement and tracks
exact backend responses; it preserves the browser's real request authority/body
and never retries. The backend, PG17, encrypted files, mTLS native worker, original
archive operations and source-destroyed/new-cluster recovery remain actual.

The separate Chromium test profile recognizes only the ephemeral certificate's
SPKI through a process-local test flag. System trust, normal browser profiles and
OS security settings are untouched. Node additionally performs actual CA/host
verification. Neither proves public-CA/browser/device trust. The flag must never
appear in deployment commands. Public DNS, CA renewal, actual employee access,
physical iPhone, off-host recovery, protected CI and online readback are separate
uncompleted gates. No API key or model call is needed for these local checks.

Official references checked for this candidate:
[reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
[request matchers](https://caddyserver.com/docs/caddyfile/matchers),
[body limits](https://caddyserver.com/docs/caddyfile/directives/request_body),
[TLS](https://caddyserver.com/docs/caddyfile/directives/tls),
[fixed release](https://github.com/caddyserver/caddy/releases/tag/v2.11.9).
