# Existing 自由手艺人 App integration — candidate, not activated

Read-only target discovery on November19 resolved the existing published app:

| Item | Verified configuration |
| --- | --- |
| Existing entry | `https://taoyouming308-ui.github.io/perm-app.html` |
| Installed app manifest | name/short_name 自由手艺人, start_url `perm-app.html` |
| Publication | `taoyouming308-ui/taoyouming308-ui.github.io`, main, repository root |
| Hosting | GitHub Pages legacy build, HTTPS enforced, no custom domain |
| Current live version | v667; public version, manifest and HTML bytes match main |
| Fetched main | `f67afc0eb2d315a881fe9da6931daa18da1fbd15` |
| Existing backend | Supabase `pdssrmpeiuwvxzsgschm`, active us-east-1 project |

The current project function metadata contains no design-photo service. The old
customer-plan tunnel is unrelated; do not reuse it for this feature. Existing
local App/tunnel/plan launch agents do not establish an independent Linux image
worker host. No exact `app1` deployment alias was discovered. The target above
is established by the existing 自由手艺人 publication record, manifest and live
readback, rather than an invented second app or an unrelated Sites project.

GitHub Pages hosts static HTML/CSS/JavaScript; it cannot run this native image
worker. Retain the existing App URL and add an independent, qualified photo API.
The host, DNS/TLS identity and production authority/schema remain dependencies;
discovering the current App URL does not provision them. See
[the previous host and lifecycle boundary](README-design-https.md) and the
adapter's `STAGING-OPERATIONS.md`. Do not deploy test SQL, synthetic identity or
receipt issuers as production authority. No API/model key is required to finish
this non-model transport work.

## Explicit frontend transport

`createPreparedHttpClient()` remains default-disabled and same-origin unless a
trusted host bridge supplies all of:

```js
{
  enabled: true,
  origin: 'https://taoyouming308-ui.github.io',
  documentOrigin: 'https://taoyouming308-ui.github.io',
  apiOrigin: /* exact provisioned HTTPS API origin */,
  allowCrossOriginApi: true,
  credentialProvider: /* current authorized employee session */,
}
```

This is a contract example, not an installed bootstrap. Never select apiOrigin
or the opt-in from query parameters, browser persistence, a customer field or
unverified remote JSON. It accepts only exact HTTPS origins, uses fixed routes,
checks the response's actual API URL, omits cookies and redirects, and retains
30s bounded responses, final session revalidation and no automatic retries.
Private upload/read approvals and backend scope checks are independent. No model
or microphone activation follows from cross-origin transport. The standalone
prepared page retains its original restrictive CSP and default-closed behavior.

## API-only ingress profile

Use the separate `design-app1-api.Caddyfile` with fixed Caddy2.11.9. Keep the
previous same-origin profile unchanged. The new profile serves no files and
requires these operator-owned values:

| Variable | Meaning |
| --- | --- |
| `DESIGN_HTTPS_ORIGIN` | Exact new photo API HTTPS origin |
| `DESIGN_APP_ORIGIN` | `https://taoyouming308-ui.github.io` for this existing App |
| `DESIGN_BIND_ADDRESS` | Explicit interface of the isolated photo service |
| `DESIGN_BACKEND_PORT` | Readiness-checked local design listener |
| `DESIGN_TLS_CERT` / `DESIGN_TLS_KEY` | Provisioned API hostname chain/private key |

Set the Node service's `publicOrigin` to **DESIGN_APP_ORIGIN**, not the API host.
The ingress preserves the browser's actual Origin. It does not manufacture
employee authority or forward an Origin derived from Host. Every backend request
still independently checks current employee access, scope and approval receipts.

Only exact raw API POST routes and their OPTIONS preflights are accepted. CORS
grants only the exact frontend origin and content-type/x-employee-session header
set, never wildcard or credential grants. Preflight ends at ingress without
reaching the backend. Private preview metadata is explicitly exposed; its
private,no-store cache header is preserved. Wrong origins, encoded/query aliases,
extra requested headers and all file requests are refused. No upstream retry,
cookie/ambient authorization, redirect or upstream CORS grant survives. The
12MiB ingress limit does not replace backend streaming limits. Error routes
preserve exact-origin access to uncertain replies without exposing error bodies.
Request objects are removed from runtime/error logs.

## Acceptance and rollout boundary

`test-design-app1-ingress.mjs` exercises actual TLS1.3, exact production-origin
matching against a synthetic upstream, denial cases, private headers, lost-reply
single attempt, size limits, log redaction and exact cleanup. It does not contact
the actual App origin or establish production authorization.

`test-design-phone-backend-browser.mjs --cross-origin-api --full-recovery
--stream-recovery` starts two different actual local HTTPS origins. Native
browser fetch performs actual CORS preflights and delivery, with no browser
interception/fetch replacement/forged URL. Only the fixture static CSP permits
the exact second local origin; production CSP files are not relaxed. Synthetic
employee/session/receipt issuance and ephemeral test certificate recognition
remain explicit qualifications. It retains the full six 12MP JPEG/PNG/WebP/
HEIC/HEIF upload-preview-review-archive and source-destroyed PG17 recovery checks,
wrong-key/scope/receipt/revocation/conflict checks and original30s deadlines.

Run the legacy same-origin HTTPS and existing browser/lifecycle regressions too.
Actual employee authority, private roles/schema migration, real Linux/rootless
image-host enforcement, public TLS renewal, physical iPhone, off-host recovery,
protected CI/merge and live readback are still separate release gates. Do not
enable production merely because these isolated transport tests pass. Never
change appointment functions, scheduled tasks or their credentials for this
deployment. The owner configures model keys securely only after non-model work.

References: [GitHub Pages static hosting](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages),
[Caddy request matchers](https://caddyserver.com/docs/caddyfile/matchers),
[Caddy response headers](https://caddyserver.com/docs/caddyfile/directives/header).
