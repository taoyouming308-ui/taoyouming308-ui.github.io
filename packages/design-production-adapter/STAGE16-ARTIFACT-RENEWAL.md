# Stage16: explicit artifact access renewal and regrant

Local, default-disabled preparation. This is a **single-artifact current-reader access** protocol, not a history/scope write manifest, historical authorship attestation, production migration, automatic approval or runtime activation. It does not grant access by matching username/store. No real customer, provider, credential or payment is involved.

## Interfaces and separation

`artifact-access-renewal.mjs` exports:

```js
const issuer = createArtifactRenewalIssuer({enabled: true, acquireIssuerClient});
const head = await issuer.head({baseAttestationId});
const intent = {
  authorizationId, requestId, baseAttestationId,
  expectedRevision: head.revision, expectedHeadDigest: head.digest,
  action: 'renew', // or independently approved 'regrant' / 'revoke'
  expiresAt
};

// A DIFFERENT trusted process/LOGIN, never the employee/runtime or artifact issuer:
const approval = createArtifactRenewalAuthorizationIssuer({
  enabled: true, acquireAuthorizationClient
});
await approval.authorize({...intent, authorizationExpiresAt});
await issuer.apply(intent);
```

The authorization issuer can separately withdraw an unconsumed intent using `revoke({authorizationId})`. Configuration is trusted server composition, not an HTTP parameter. There is no automatic renewal loop, expiry wake, fallback authorizer, model call or exposed user route. Production approval policy and authenticated human/service issuance UI are not provided by these factories.

`postgres-artifact-renewal-repository.mjs` exports `createPostgresArtifactRenewalRepository({enabled:false,acquireClient}) -> {repository,issuer}`. These implement the existing Stage14 compatibility seam. The coordinator can deliberately select this read mode; it is not installed automatically. Unenrolled artifacts deny in this mode. Every new read selects the checked current chain head and still runs the unchanged old reader between two fresh sidecar transactions. New head selection does not replace old source/media/ancestry authorization.

This module does not issue the separate exact scope/history authorization manifest. That contract and its worker remain independent. A read renewal never authorizes upload, candidate generation/adoption, workflow/full writes, key use, or claiming an old author's work.

## Exact transitions

- **renew:** head must have `active:true`, including an expired but never-revoked grant. Expiry must strictly increase and be no later than one hour from the new grant's server time. An expired proof does not renew itself; a newly recorded independent authorization is mandatory.
- **revoke:** head must have `active:true`. Append a new `active:false` proof, preserving its prior issue/expiry dates. This can withdraw access even if the target employee/source is no longer active; it never grants data access.
- **regrant:** head must have `active:false`. It needs its own independent, exact `action:'regrant'` intent. A prior renew authorization cannot revive a revoked head. The same original reader tuple must still be currently valid, and the exact source must remain active/unchanged.

Changing immutable employee, employment, membership, store, security epoch, membership revision or binding revision cannot be smuggled into renewal. Those cases need a separately reviewed new initial artifact grant. Current access does not resolve historical authorship. Original `authorship.status:'unresolved'`, legacy actor text, original source records and embedded native hashes are preserved.

The authorization records exact action, base ID, expected revision/digest, request ID and requested expiry, plus independently loaded base artifact descriptor and reader. It is live for at most five minutes. The artifact issuer cannot create it. It is consumed atomically with the new revision/head/request receipt, never before a separate unprotected write.

## Old-base bypass and preservation semantics

On **first explicit enrollment only**, one transaction:

1. Stores the complete original Stage15 proof as immutable `genesis`, together with the original descriptor, reader and source snapshot.
2. If that base is active, permanently marks it revoked using the unchanged Stage15 monotonic revoke rule. Already-revoked bases are not rewritten.
3. Appends the explicitly authorized new revision and head.

The original Stage15 **active flag/revision do change once to a permanent tombstone** when enrollment starts from an active base. Do not claim those two live-row fields are byte-unchanged. Its pre-enrollment proof is preserved exactly in immutable genesis; original artifact content, source snapshots, native version hashes and historical authors are never rewritten. Every later transition is an append-only revision, not a modification of an old revision.

This tombstone is a database-level boundary: the old Stage15 fixed read functions remain unchanged but reject the revoked base. Direct old-function calls cannot bypass a revoked/expired/new chain by relying on the old active grant. The new reader additionally requires the base tombstone still equal its pinned snapshot. It never falls back to the base if a new head is revoked, missing or corrupt.

## Durable chain, CAS and replay

The additive test schema holds:

- immutable `chains`: genesis, permanent base tombstone, exact artifact/reader/source;
- immutable `revisions`: previous digest, action, authorization/request IDs, server time and complete proof;
- protected `heads`: exact current revision/digest with a monotonic CAS update;
- protected independent `authorizations`: immutable intent plus one-way withdrawal/consumption;
- immutable `requests`: exact input and applied revision/digest.

Reads validate the complete bounded chain, predecessor links, transition semantics and exact head. Maximum 100 appended revisions; a request beyond that capacity rejects before append. These digests use a new, explicitly named PG17 `jsonb::text` hash domain. They are consistency fingerprints internal to this chain, **not** replacements for the existing JavaScript/native artifact hashes, cryptographic user signatures or authorization by themselves.

Concurrent successors with the same expected head cannot both apply. Identical request retry returns the original immutable revision and digest plus `currentRevision/currentDigest`; it does not move the head backward. An old successful renew response can therefore be read back after revocation without making it current. Changed input with the same request ID denies. An uncertain COMMIT never triggers automatic retry; explicit same-request reconciliation is the only tested recovery path.

## PostgreSQL and transaction boundary

The SQL file is `drafts/stage16-artifact-renewal-fixture.sql`, guarded for the disposable PG17 identity/artifact fixture. It is not a migration or installer for production. No password is created.

- Existing `design_identity_runtime` has only the new fixed read/verify functions, not proof/authorization CRUD, issuer functions, role membership or schema creation.
- Existing `design_artifact_issuer` can request head metadata and apply a separately authorized transition, but cannot authorize its own intent.
- New `design_artifact_authorizer` is a distinct restricted LOGIN with only exact authorization/withdrawal functions. Its NOLOGIN function owner is not a table owner or BYPASSRLS role.
- Private tables use ENABLE/FORCE RLS, revoked PUBLIC privileges, fixed search paths and distinct fixed-function responsibilities. Append-only, CAS and one-way authorization triggers complement those checks.

The source/identity/proof checks and authorization consumption share one real connection and transaction. The exact existing `design-prepared:transaction:v1` advisory lock serializes supported old writes and the new transitions. This is intentionally global and limits throughput. It is not a lock against trusted administrators issuing unrelated direct SQL. Existing immutable source triggers and old reader checks are retained.

As in Stage14/15, the **entire read** is not a single connection: fresh inspection, old reader independently authorizing in its own transactions, then a second fresh inspection. If a renewal/revocation changes the head between them, the result is withheld. No indefinitely valid result or physical network-delivery atomicity is claimed.

Authorization/source checks are current at their final fixed transaction checkpoints. The previously exposed arbitrary-SQL `SET CONSTRAINTS ALL IMMEDIATE` deadline issue remains an independent deployment blocker. This protocol does not claim that adding another final timestamp makes expiry-at-physical-COMMIT absolute. Production role/broker/approval-service and full write-path review are still required.

## Verification status

Author pure protocol tests: `node --test scripts/test-design-artifact-renewal.mjs` **13/13 passed**. Syntax and `git diff --check` passed. They test default closure, exact inputs, distinct authority factories, no base fallback, same-lease final checks, guard lifecycle, poisoned SQL errors, immutable input snapshots, fixed errors and uncertain COMMIT. They mock SQL and are not RLS acceptance.

Coordinator-controlled first actual PG attempt passed the first three cases, then denied the first approved issuance. The fixture was cleaned up. That attempt did not capture SQLSTATE, so its exact failure cause was not reproduced or proven. Static review identified four ambiguous JSONB extraction/subtraction expressions; all now explicitly parenthesize extraction. The known operator-precedence risk has constant-expression evidence, and a real SQL constant regression plus read-only HTTP composition checks were added.

The corrected coordinator-controlled actual PG run passed **17/17**, exit 0, with exact container cleanup verified. Log: `/tmp/stage16-renewal-pg-fixed.log`. No Docker run was performed by this worker:

```sh
node scripts/test-design-artifact-renewal-postgres.mjs --diagnose
```

The optional `--diagnose` emits only fixed operation/role names, case numbers and SQLSTATE codes, never statements, parameters, raw errors or source content. The passing cases include real role denial, explicit enrollment/base bypass rejection, actual old full-history reader with a different historic author, the root read-only HTTP factory in explicit `proofMode: 'renewal'` plus denied base mode and write routes, exact immutable replay, wrong action/CAS rejection, renew versus regrant, withdrawn/expired approval, concurrent successors, source revocation, expired base requiring new approval, real COMMIT acknowledgment loss and immutable identity epoch changes. The original old reader still uses its existing privileged synthetic executor; this is not proof that all legacy consumers have migrated to a production minimum-privilege role. A metadata-only synthetic media source is used only for a source-revocation negative test; no photo bytes or storage/decoder claims are made for that fixture.

The coordinator ran isolated Docker serially and recorded exact cleanup. This is restricted-role synthetic PG acceptance of the described slice, not production enablement. No production, credentials, real data, paid calls or deployment is enabled by a passing test.
