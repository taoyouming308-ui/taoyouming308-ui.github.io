# Stage39: explicit application-level private object storage

Status: source-only isolated implementation/acceptance complete. Baseline75794f21/v689 clean,
fresh fetch/gates/daily backup and complete private recovery bundle verified.

## Newly accepted scope

After Stage38, the owner explicitly agreed to continue testing on the existing cloud
storage with program nonoverwrite/read verification, while checking independent
photo backups and restoration before formal use. This accepts evaluation of a new
application-level immutable mapping, not native WORM or guaranteed recovery after
administrator deletion. It does not authorize live service roles, permission
expansion, secret configuration, paid calls, production migration/deployment or
real customer transmission. No live cloud operation is part of this stage.

## Non-negotiable compatibility boundary

The current retained-native-version backend and derived/normalized stores require
native immutable versions. Ordinary Supabase path GET must never be wrapped with
fabricated objectVersion/immutable=true to satisfy them. New intent/manifest/ref
schemas and a separate create-only/read-exact backend will not rewrite old records,
proofs, stored hashes or authors. Until a full distinct authorized path is connected,
new backend code is not a production-ready replacement.

## Bounded offline outcome

Define scoped content addresses and append-only revision/source bindings; implement
fixed-endpoint create-only and exact bounded reads with injected mock transport,
no environment credential discovery, no redirects/retries, and explicit uncertain
write outcomes requiring read-only reconciliation. Verify same-name/cross-scope,
altered bytes/manifest, conflicting creates, length/stream/abort and unknown-reply
failures. Hash checking proves byte equality, not decoding, retained versions,
backup availability or authority. Fresh service authorization and durable DB claims
remain required at the publication boundary.

Actual deployment still requires a reviewed restricted runtime identity, no bypass
RLS service-key claim, private bucket/prefix and access policies, budget/usage checks,
secure secret delivery and one approved finite synthetic service qualification.
Independent backup/restore must be demonstrated before customer use. All such
conditions remain unperformed and production stays off.

## First execution milestone is source-only

The distinct schema may describe derived ancestry for future reviewed adapters, but
this stage's executable store/PG lane accepts only source objects. Derived and
normalized writes remain denied. Do not introduce a parallel synthetic processing
issuer and present it as reuse of the existing independent processing/verifier
chain. A future explicit reference/authorization version seam must connect that
chain; old candidate/verifier inputs still reject these new manifests. This finite
milestone proves source-object protocol/persistence, not usable model input or a
replacement production image pipeline.

## Publisher trust and expiry review

The DB can verify current identity, the reserved request and append-only/CAS state;
it cannot observe a Supabase HTTP response or establish bytes were decoded. A
trusted runtime's readbackAssertion is not an independent verifier attestation.
The store checks actual returned bytes before publication and again on reads;
compromise of the trusted publisher is outside this narrow assertion guarantee.
Sources remain ineligible as verified model inputs.

Review must distinguish a short-lived upload/claim permit from future published
object reads. Never silently extend the original write permit or use a new read
permission to reopen a PUT. A published-history read requires a separately explicit
current authorization path, not an indefinitely cached upload grant. Any missing
renewal/read-authorization seam must be listed as a persistent-archive rollout gate.

## Lifecycle corrections required by review

A permanent reservation combined with a short upload TTL would otherwise lock an
asset forever; reusing the upload permit for all future reads would also make old
archives inaccessible after expiry. The approved offline design now separates:

- upload permit: fixed TTL, no renewal, once-claim, write revoke stops further write
  or publication;
- published-object read grant: explicitly issued for one exact manifest and full
  current authority, independently revoked/renewed by a new append-only grant, never
  opens PUT or alters authors; fresh service access still required;
- unpublished-reservation termination: independent authorized issuer action,
  append-only tombstone, irreversible for the old claim. It may free that head for
  a new request but cannot delete history or make a late old upload publishable.

A metadata/commit-receipt check after the original put is not a new historical
object read. Their trusted operation purposes must stay distinct so read-grant
absence cannot be bypassed by caller-chosen flags or silently turn every successful
put into an uncertain result. Production issuance/roles remain entirely unapproved
and unconfigured; this is isolated schema/adapter validation only.

The prepared Supabase HTTP adapter requires a server-supplied short-lived
`authenticated` access token and publishable API key. An existing custom employee
session token is NOT such a Storage credential and must not be relabeled. How the
dedicated restricted Storage identity obtains/refreshes its token is a separate
reviewed deployment dependency; no Auth account, signing secret or refresh credential
is created here. Local JWT parsing rejects obvious bypass keys but neither verifies
signatures nor proves deployed RLS. The live service must enforce and independently
test the configured identity's exact bucket/prefix INSERT/SELECT restrictions.

Cross-epoch/reassignment regrant remains deliberately unsupported here. The new
issuer cannot terminate or read another historical full-authority tuple merely
because names or stable subject IDs match. Thus termination handles abandoned
requests under the same freshly authorized identity/binding, not every historical
stuck asset. A reviewed provenance-preserving regrant seam is still required for
changed-authority historical access; existing author/ref/digest must not be rewritten.

## Verified stage result

Final pure modules passed: contract18, source store28, fixed HTTP backend23 and
fixed PG executor10. Earlier retained native-version/storage/processing51 passed;
old files were not modified. Actual restricted non-owner PostgreSQL source smoke3
and complete acceptance19 passed, with actual repository/store/backend code and
synthetic mock HTTP only. Exact cleanup ended with17 created leases and zero active
relay children, total/idle/waiting pool entries. No cloud Storage request occurred.

The full run covers two immutable source revisions/old reference read, independent
read grants, same-request cross-scope refusal, one claim across two real connections,
unknown PUT/claim COMMIT/publication COMMIT, rollback recovery without another PUT,
write expiry/revocation, read expiry/revocation/explicit renewal, termination before
late publication and refusal after publication, provider overwrite/delete detection
and new-valid-epoch denial. A deliberate trusted-publisher control proves the DB
does NOT attest external readback; missing actual bytes still fail the store read.
These are engineering checks with synthetic byte strings, not customer cases or
image decoding/model-quality qualification. Default30s store budgets unchanged.

First complete run stopped6/19 because the negative-test harness expected an async
rejection from a synchronously rejected derived intent. Only that test wrapper was
corrected; failing evidence retained. Review also removed unnecessary config FOR
SHARE instead of granting UPDATE, tightened read selectors and restricted the raw
before_read phase to claimed requests. No old authority checks were relaxed.

No public UI/API activation or original native-storage replacement occurred. New
manifest references still need explicit integration with the existing independent
processing/verifier/candidate chain and App upload flow. Cross-epoch regrant, live
least-privilege Storage credential qualification, backups/restoration, actual cloud
cost/settings and real image/model qualification remain rollout gates. The older
intermittent PG root cause and long-history load are not resolved by this small
source fixture. The accepted application-level guarantee is not WORM or recovery.
