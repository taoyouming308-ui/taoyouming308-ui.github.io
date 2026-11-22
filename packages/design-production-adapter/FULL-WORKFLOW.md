# Full workflow archive preservation, prepared only

`full-workflow-archive.mjs` is an additive, default-disabled contract and injected transaction adapter. It does not query a database, migrate existing rows, upload photos, call a model, deploy a route or replace the legacy append RPC. The public HTTP route is separately prepared; production still needs a reviewed authoritative transaction implementation. All tests use synthetic native records and in-memory transactions.

## What “lossless” means here

Three native representations are deliberately **not claimed to be equivalent**:

- UI projection: exact `design-pilot-ui-state-v1` state, original field records, separate planned/actual records, service visibility flags, all per-zone group arrays, selected stage, original text, fixed transcript, synthetic image markers, append-only history and every archive checkpoint. It remains the existing synthetic-only schema. This module does not turn it into a real-customer/free-input UI schema.
- Evidence journal: exact validated v2 session, sources, quotations, entry/confirmation/replacement history, stable group/service/side identities and native archives. Earlier v1 archives are retained unchanged when the session contains an already-performed explicit v1→v2 migration. The module does not initiate migration. A current unmigrated v1 session is refused, not silently upgraded.
- Legacy documents: the complete public version shape defined by the legacy archive adapter, including all baseline/optimized/reason/execution/process/review fields, status, photo UUIDs and version metadata. This is not an unrestricted raw SQL-row export. Unsupported columns/formats are rejected, not stripped or squeezed into text fields.

The returned snapshot retains every accepted native JSON value. Unpacking recovers the original input exactly, including string whitespace, unknowns, original source quotes and existing confirmation states. No field is automatically confirmed, no plan becomes an actual result, no left/right plan is mirrored, and no UI group array index is invented as a stable evidence `groupId`. UI placement remains its original record; its index identity deliberately uses `side:null` and `groupId:null`.

A derived JSON-pointer index makes fields, groups, sources, journals, archives and photo references discoverable. It is recomputed and checked on load, not accepted as independent authority. Full original histories remain in the snapshot, not merely in an index or summary.

## Pure contract

```js
const snapshot = createFullWorkflowSnapshot({
  scope: {customerProfileId:'11', visitId:'booking:101', assignmentSource:'appointment'},
  store: 'synthetic-store',
  bindings: {
    uiScope: {customerId:'demo-profile',visitId:'demo-visit',sessionId:'demo-ui-session'},
    evidenceScope: {customerId:'11',visitId:'booking:101',sessionId:'synthetic-evidence'},
  },
  ui: {state: validatedNativeUIState, archives: allNativeUIArchives},
  evidence: {session: validatedNativeEvidenceSession, archives: allNativeEvidenceArchives},
  legacyVersions: allNativeLegacyVersions,
  photoRefs: scopedReferenceRecords,
});
```

A missing UI/evidence lane is explicitly `null`, with the corresponding native binding `null`; legacy versions and photo references use explicit arrays. At least one native document lane is required. Evidence customer/visit IDs must exactly match the production scope. UI fixture IDs are a different namespace and must be explicitly bound by a trusted resolver, not equated to `booking:`/`frontdesk:` IDs or matched through names/phones.

Exports:

- `createFullWorkflowSnapshot(input)` creates a frozen versioned envelope and deterministic index/digest.
- `validateFullWorkflowSnapshot(snapshot)` validates all native contracts and recomputes index/digest.
- `unpackFullWorkflowSnapshot(snapshot)` returns the complete original input shape.
- `serializeFullWorkflowSnapshot(snapshot)` emits canonical JSON.
- `parseFullWorkflowSnapshot(text)` accepts that exact canonical encoding. Alternate whitespace/key order or duplicate-key encodings are rejected, not silently normalized. Object-input validation is semantic JSON validation; strings themselves are never trimmed or rewritten.
- `validateFullWorkflowVersion(version,scope)` and `validateFullWorkflowChain(versions,scope)` check version/parent/digest/native-history continuity.

UI/evidence native archive arrays must contain every corresponding archived checkpoint in ascending revision order. Each archive must match the current history prefix exactly, including the archive reached during explicit migration. Legacy versions must start at version one with no gaps and exact parent UUID linkage. A later full version may append native history and media references, but may not remove a lane, rewrite old records, drop old native archives or reparent the session.

SHA-256 here is a consistency/integrity checksum, **not a user signature, proof of source authority, proof of consent, or proof that an untrusted database has never been rewritten**. Self-consistent fabricated journals can pass pure schema checks. The transaction must independently verify the source snapshots and trusted bindings below.

## Photo references without flattening

`photoRefs` is an explicit union:

```js
// Existing legacy photo namespace. Legacy photo_ids must resolve to this kind.
{kind:'legacy_asset',assetId:'<UUID>',scope,store,
 stage:'before'|'after'|'unknown',angle:'front'|'back'|'left'|'right'|'unknown'}

// Exact reference object returned by private-media.resolveReferences.
{kind:'private_media',scope,store,reference:{
 mediaId:'opaque_ref-A',stage:'before'|'after'|'reference',
 angle:'front'|'back'|'left'|'right'|'detail',mime:'image/png',
 byteLength:1234,width:320,height:240
}}
```

Private `mediaId` remains the native opaque identifier. `reference`/`detail`, MIME, length and dimensions are retained without normalization or loss. The two ID namespaces are not automatically merged even when their strings happen to match. No private-media ID is silently copied into legacy `photo_ids`. UI synthetic markers remain separate from both real-asset namespaces.

Only bounded metadata/IDs are accepted; no URL, signed URL, storage path, original filename, token, base64 or image bytes field exists. A saved reference is **not** a permanent access capability. `verifyPhotoRefs` must re-read active private records, compare every reference field and exact employee/store/customer/visit binding inside the archive transaction. Prior `resolveReferences` success alone is insufficient. Before any future image read/provider use, the media service must independently reauthorize again.

## Append API and transaction requirements

```js
const adapter = createPreparedFullWorkflowArchive({
  enabled:false, // default; explicit server configuration required
  permissionGate, transaction, clock,
});
await adapter.append({
  credential,scope,requestId,
  expectedVersion:0,expectedParentDigest:null,
  snapshot,
});
```

`permissionGate.authorize(credential,scope)` returns exactly `{actor:{username,store},scope}`. The actual production employee/visit adapter can supply this gate; browser claims or synthetic actor headers cannot. Caller mutation is detached before asynchronous work. No client actor, timestamp, binding revision or new version number is accepted.

`transaction({scope,actor},callback)` must provide these **same-transaction** dependencies:

- `permissionGate`: fresh authoritative employee/assignment checks participating in the transaction's authorization locks/version preconditions.
- `verifyBindings({grant,scope,bindings})`: authoritative explicit mappings, returning exactly `{scope,store,uiScope,evidenceScope,revision}`. It must not merely echo the supplied aliases. Binding revision must change whenever authority changes.
- `verifyPhotoRefs({grant,scope,photoRefs})`: return exactly `true` only when all current native asset bindings/metadata match and remain permitted.
- `verifySourceSnapshots({grant,snapshot})`: required, returning exactly `true` only after independently reading the trusted native repositories and comparing the complete legitimate snapshots/history at their recorded checkpoints. Confirmations and sources may not be established from the submitted snapshot or its hash. Initial write uses authorized known source checkpoints; replay may verify the exact known historical checkpoint, not replace it with newer UI state. Missing/truncated native history must fail. This source verifier is also re-run before commit and replay delivery.
- `readVersions()`: the full immutable chain for this exact scope, never a silently truncated page.
- `findReceipt({requestKey})`: globally unique actor/request receipt lookup. Scope changes under the same actor/request must conflict, not become a second request.
- `appendVersion({version,receipt,expectedVersion,expectedParentDigest})`: atomically compare the current head and append both immutable version and unique receipt; return exactly `true` only if staged. It must not commit independently. Missing receipts, corrupt receipts and unexpected readback fail closed.
- `beforeCommit(hook)`: register an awaited final recheck immediately before commit. Throws must roll back **both** version and receipt. Authorization, source, binding, asset and head rows require a consistent lock order or equivalent serializable checks through commit. Several REST calls are not one transaction; a stale snapshot or callback flag is not proof of these database properties.

The adapter rechecks permission, binding revision, every photo reference and authoritative source snapshots; validates staged readback; then verifies the executor actually invoked its final hook. There is no live implementation of this transaction in the module. The current legacy SQL executor is not sufficient for this full schema without a separately approved additive design.

Result is `{saved:true,replayed,appliedVersion,observedHeadVersion,version}`. A version includes exact actor/scope/request, server timestamp, binding revision, full snapshot and `{version,sha256}` parent linkage. `observedHeadVersion` is the head seen in that transaction, not a promise about a later live head. Same request/payload returns the original immutable version even after subsequent versions. A changed payload/expected head under that request conflicts.

Unknown commit acknowledgment, missing final guard, or authorization/return failure after the transaction returns produces `FULL_OUTCOME_UNCERTAIN` with `outcome:'uncertain'` and no snapshot. A version may already exist. Keep the exact request ID/payload and reconcile/retry only under renewed authorization; do not assume failure and generate a new append. All errors use fixed local codes, not native repository messages, and `retryable:false` does not authorize an automatic retry.

## Bounds and verification

Snapshot limit: 32 MiB, including derived index. Version envelope: snapshot budget plus 64 KiB. Full-chain validation: at most 100 versions and **64 MiB aggregate**, with a shared 750,000-node/80-depth budget; bounded traversal runs before constructing per-version copies. JSON strings/keys are capped at 65,536 code units before encoding, and byte accounting happens during traversal. Unsupported/oversized data fails rather than truncating originals. Histories that exceed these bounds need a separately reviewed paged immutable design, not silently dropping old versions. A future repository must also bound its read/materialization before handing values to JS.

Run `node scripts/test-design-full-workflow-archive.mjs`. The 32 synthetic checks cover complete reversible snapshots; all 96 UI groups; plan/actual/source/confirmation preservation; native v1 migration archives; immutable parent/history and CAS; exact retries and lost acknowledgments; late revocation rollback/uncertainty; forged self-consistent source data and incomplete authoritative history; photo scope and complete private-media reference composition; aggregate bounds; and the actual prepared HTTP full-archive route composed with this adapter. The mock executor proves control flow, not real PostgreSQL isolation or production source provenance. No real data, upload, migration, model charge or deployment is performed.
