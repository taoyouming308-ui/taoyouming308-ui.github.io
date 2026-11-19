# Minimal deployment plan, review only

2026-11-16. This is an ordered readiness proposal, not permission to execute it.
Stage19 remains an isolated implementation candidate. No destination, deployment,
production DDL/grants, live secret, customer-data transfer or fee is enabled here.
Use the full `DEPLOYMENT-APPROVAL-CHECKLIST.md` for existing unresolved gates.

## First live scope, if later approved

One explicitly identified owner/test employee, one store and explicitly assigned
visits only. Do not provision five staff, infer identity from names/phones, migrate
old keys/requests, or enable background access to all customer archives. Service
workflow records do not become a shared knowledge/training source. The proposed
broader backend mining is still an unevaluated/unapproved access expansion.

## Minimum independently reviewed components

1. **Host and listener:** name the host/account/region, authenticated HTTPS origin,
   revision and rollback revision. Keep the static homepage feature flag off until
   the exact backend graph is accepted. The repository supplies factories, not an
   already provisioned production server or credentials.
2. **Employee runtime:** non-owner, no superuser/BYPASSRLS, no role membership or raw
   table access; allow only enumerated fixed capability functions. Resolve immutable
   membership and exact assignment/lifecycle before each scoped operation. The test
   schemas are synthetic fixtures, not executable production migration instructions.
3. **Private function owners:** NOLOGIN/non-owner capabilities with the exact internal
   dependency privileges proved by tests. Review EXECUTE plus transitive invoker
   function dependencies; never solve a missing helper grant with schema-wide grants,
   table-owner access, service-role bypass or PUBLIC execution.
4. **Independent approval service:** authenticate the actual approving person and
   bind exact identity, source revision, purpose, recipient and scope. Image processing
   permission precedes derivative work; external transmission/cost approval binds the
   actual metadata-stripped payload digest and destination. Removing metadata does
   not anonymize a visible customer face. Runtime cannot mint these receipts. Mock test issuers are not a production consent service.
5. **Secret custody:** decide the actual approved vault/master-key custodian, process
   boundary and rotation/revocation procedure. Existing callbacks decrypt into bounded
   application memory; this is not proven cross-process isolation or secure erasure.
   Request a personal API key only through an authenticated safe settings path, not
   conversation, source code, browser persistence or shared logs. Key-settings and
   processing-route factories still require reviewed listener composition.
6. **Private media and decoder:** choose private bucket/namespace and least-access
   storage identity; no public image links or Files API uploads. Qualify the existing
   controlled Linux worker requirements without changing host security to bypass
   them. A synthetic whitelist inspector is never a production decoder. Preserve
   object/metadata uncertainty and orphan reconciliation instead of blind deletion.
7. **Audit and budget:** log safe request IDs/state transitions, not plaintext keys,
   photographs, transcript bodies or authorization tokens. Retain unknown dispatch
   tombstones and prohibit automatic paid retries. Verify current provider pricing
   and a separately enforceable budget policy; approved maximumMinorUnits alone is
   not a vendor-enforced billing cap. No auto-top-up or subscription is authorized.

## Measured deadline limitation

The Stage19 original-homepage synthetic chain passed12 assertions, but the slowest
request was28.398s under an unchanged30s client budget. Only1.602s remained with a
mock provider. Actual decoder/provider latency and longer history may exceed the
budget; this is not live readiness. Profile phases and safely reduce duplicate work,
or review a durable asynchronous delivery design, before a paid trial. Never remove
authorization, automatically resend an uncertain request or simply enlarge timeouts
to label the existing result successful.

## Deployment order and stop points

- Review exact schema mapping, migration diff, fixed-function ACL/RLS catalog and
  real non-owner test evidence in a staging target. Preserve old rows/hash/authors.
  Unsupported UI-only history and cross-stylist private originals remain denied.
- Reproduce and diagnose the historical PG intermittent failure before live use;
  newer successful synthetic cases do not establish its root cause. State transaction
  lifetime/hostile-SQL guarantees accurately, not absolute wall-clock-at-COMMIT claims.
- Test revocation, changed assignment, same-name replacement, unknown receipts,
  process restart, malicious media and rollback in that actual target. Retain default
  request budgets and stop on a failure; do not remove authorization to improve speed.
- Obtain the required confirmation for the named production roles/access changes,
  persistent secret custody and deployment action once material details are known.
  Then request secure key entry and separate exact customer-data processing/spending
  authorization. Owner approval alone does not replace the customer's consent.
- Enable only the owner trial scope. Verify live route/identity/catalog and audit
  readback without exposing secrets; if it fails, close the feature/egress and use a
  forward rollback. Preserve requests and financial uncertainty; never erase evidence.

No owner decision is required to continue synthetic development. Do not ask for a
key now. The next consequential question needs a concrete proposed host, permission
set and secret/worker arrangement, not an open-ended request to "approve everything."

## Provider contract reference, not a model selection

Read-only checked on 2026-11-16: the official [vision guide](https://api-docs.deepseek.com/guides/vision/)
and [Chat Completions schema](https://api-docs.deepseek.com/api/create-chat-completion/)
describe inline image_url data-URL parts and chat-completion responses. Our narrow
PNG/derivative/response validators and synthetic models do not verify real hair-design
quality, customer suitability or actual usage charges. Selecting/approving a live
model and its limits is a separate configuration decision.

## Stage 20 follow-up (still no activation)

See `STAGE20-PERFORMANCE-REVIEW.md` for isolated phase measurements, an opt-in **test-only** bounded warm pool and a guarded equivalent SQL leaf-serialization optimization. These do not configure a production driver or apply a production migration. The original 28.398-second browser observation remains historical evidence; use the separately recorded final Stage 20 browser scenario results, not database-only timings, to assess synthetic request headroom. Real worker/model latency, long-history/load, historical PG intermittency and all concrete deployment/approval gates above remain unresolved.
