# Candidate provenance and authoritative acceptance

These are offline-prepared server capabilities, not deployed routes or production schema. They neither call a model nor create a database connection. The existing executor still requires an explicitly supplied trusted client, authoritative session/binding/lifecycle configuration and its deferred commit-deadline contract. No live schema, permission or credential was changed.

## Public repository capabilities

`createDesignPostgresRepositories({executor})` exposes:

- `resolveVisitScope({credential,visit}) → {scope}`. The exact visit locator has only `assignmentSource` and `visitId`. The resolver derives the profile from the authoritative binding, verifies the real employee/source/shared customer context and repeats the check in an independent transaction before return. Names, phones and client profile hints are not accepted. This is a read-only bridge for the old App entry, not a new right to browse unrelated visits.
- `createCandidateRepository({ttlMs}) → {publish,load}`. TTL is explicit trusted server configuration, an integer from 1,000 to 3,600,000 milliseconds. No default authorizes candidate operations. The database clock determines expiration.
- `publish({credential,scope,candidate}) → {candidate,replayed}`. Only trusted model-generation orchestration may call it. The HTTP client never supplies the candidate envelope. A fresh candidate must exactly match the current native session ID, revision and canonical digest, current employee/store and scoped media sources. Same-ID identical publication returns the original immutable artifact without extending its expiration; changed contents conflict. A fresh post-commit read checks authority and source/media again. Failure after acknowledged publication is uncertain, not permission to repeat a model call.
- `load({credential,scope,candidateId}) → {candidate}`. Pending artifacts require current access, active candidate metadata and an unexpired TTL. After media and final authorization waits, the last database-time check rejects expiration that occurred during those waits. A stale base can be reviewed but cannot be accepted. Consumed artifacts may be read after TTL expiration; current authority and media still apply. Candidate revocation denies this preview endpoint. Accepted archival evidence is not deleted or rewritten by expiry or revocation.
- `verifyCandidateMedia({credential,scope,actor,sourceRefs}) → true`. This freshly verifies the exact current employee/visit binding, that every media ID is already attached to the current workflow, that the original is active, and that its immutable original hash matches `sourceSha256`. Each reference has `mediaId`, `sourceSha256` and optionally `derivativeSha256`. A derivative hash is retained provenance, not proof about the original bytes or an authorization claim.

All returned objects are immutable copies. These are server-only capabilities, not generic record-write or SQL APIs.

Preview is a read-only snapshot at its **last database validation point**. The final read COMMIT or network delivery can occur later, including after the pending TTL expires. No expiry guarantee at network arrival is claimed, and preview never authorizes acceptance. Reads do not add commit-check writes or new permissions. Explicit acceptance independently checks current state and uses the deferred database deadline at actual write COMMIT.

## One explicit acceptance, one atomic transaction

The workflow intent is exactly:

```js
{type:'accept_model_candidate',candidateId,selectedIndices}
```

It contains no model output, source text, image hash, employee identity or confirmation flag. The existing transaction's `readCandidate` capability loads the complete immutable server artifact. Acceptance checks the current native session and original media, then applies the pure candidate contract. Employee original text remains employee evidence. A visual description has `actor:'model'`, `kind:'image_description'` and remains unconfirmed. Selecting it is not factual confirmation.

Workflow version, original request receipt and candidate-consumption receipt are inserted together on the same PostgreSQL connection. A candidate can be consumed only once. Its expiration is included in the executor's real deferred database deadline, including the JavaScript-to-COMMIT interval. Guard failure rolls all rows back. An unknown COMMIT result stays uncertain; exact original request replay reconciles the already applied revision rather than consuming a second time. A new request cannot reuse a consumed or stale candidate.

The uninstalled synthetic schema adds immutable `model_candidates`, immutable `model_candidate_acceptances` and monotonic `model_candidate_access` tombstones. Access can move only from active to revoked; IDs are never deleted or recycled. The acceptance receipt binds full scope, candidate digest, workflow receipt key and the complete acceptance metadata. History reads recompute those bindings against the actual immutable candidate row. A caller-supplied hash alone cannot establish provenance.

## Explicit v2 upgrade without changing v1 history

Only candidate acceptance upgrades a prepared record to `design-prepared-workflow-record-v2`. Old records remain v1 with no new empty field. The new lane is:

```js
modelCandidates: [{
  candidate: completeImmutableEnvelope,
  acceptance: {requestId,workflowRevision,receipt}
}]
```

The envelope preserves model and prompt identifiers, exact base-session and outgoing-payload digests, the candidate entries/questions/warnings, original text references, model-description sources, and original/derivative media hashes. The receipt preserves selected indices and exact native revision boundaries. Unselected fields remain in the original artifact; they are not silently presented as accepted entries.

Full snapshots containing this lane use `design-full-workflow-snapshot-v2`. V1 canonical bytes and hashes remain unchanged. The full-version wrapper retains its existing schema while validating either supported snapshot version. Chains may append v2 after v1, but may not drop or rewrite the candidate lane. The pure history validator reconstructs each original native-session checkpoint, validates the full candidate there, reapplies the exact selection and compares both receipt and resulting journal prefix. It is an integrity check, not a substitute for server authentication or the immutable repository.

Expiry prevents new acceptance of pending suggestions. It does not remove already accepted provenance from workflow or full archives. Current media revocation may still deny delivery of an archive containing those references, without mutating the archive. Employee reassignment does not automatically transfer private-image ownership.

## Verification and deployment boundary

The guarded Stage8 SQL is loaded only by the unique, network-disabled temporary PostgreSQL 17 fixture. It is outside automatic migrations. Synthetic administrator tests do not certify production RLS, grants or least-privilege roles. Production still needs an independently approved migration, issuer/retention/revocation policy, source-binding/lifecycle approval, driver/runtime and writer-lock review. Node tests do not establish Supabase Edge/Deno compatibility.

Model execution, transmission approval, paid-attempt replay and private derivative generation belong to their separate adapters. This repository does not make provider output accurate, approve a paid request, or turn customer material into a knowledge-base candidate.

## Completed-photo comparison extension

The existing `design-model-candidate-v1` envelope now has a strict kind-specific branch for `completion_comparison`. Only this kind has the additional `comparison: {beforeMediaId, afterMediaId, angle}` object. Existing text and before-photo envelopes are unchanged and receive no empty fields or hash migration. No new database table, RPC, installed migration or permission is introduced.

The two `sourceRefs` are ordered before then after, retaining both original and derivative SHA-256 values. Publication, preview and acceptance require both current active private-media records already attached to the same authorized workflow. The immutable metadata must agree with stage `before`/`after` and the same explicit `front`, `back`, `left` or `right` angle. A reference image, detail angle, swapped stages, mismatched angle, missing attachment or legacy-asset substitution is refused. Declared hashes alone never authorize access; live original hashes are compared separately. Pure accepted-history/full-snapshot validation also checks the paired photo metadata, while the repository continues its current-media authorization before returning data.

The candidate is restricted to `completed_review`. Its model-authored, unconfirmed observable result uses one of `model_photo_comparison_front`, `model_photo_comparison_back`, `model_photo_comparison_left` or `model_photo_comparison_right`. Separate angles remain visible; the employee's `observed_result` is not replaced. The complete candidate, comparison object, two image references and acceptance receipt remain in the v2 provenance lane and full archive. Existing receipt/CAS/idempotency, expiry-at-acceptance, append-only history and uncertain-commit rules are unchanged. Synthetic comparison fixtures test persistence and permission boundaries, not model quality or whether a real result met a design target.

## Three-view synthesis and ancestor access

`completion_synthesis` is another strict kind-specific branch of the same envelope version. Only this kind adds `synthesis`, preserving the selected left/right side, 1–3 accepted comparison evidence rows in front/back/selected-side order, explicit missing/uncomparable/conflicting angles, bounded assessment, generation mode and selected review focus. Each evidence row retains the immutable ancestor candidate ID/digest, accepted entry/request IDs, its status at that checkpoint and its bounded judgment. Its 2–6 ordered image references are the unchanged original/derivative references of those ancestors. A summary is not a new visual observation and cannot infer procedures, mixtures, measurements, success or causation.

The generation service computes all evidence and limitations. With zero or one available review focus it performs deterministic local assembly with no new model/key/transport/paid operation; the source is `server_synthesis` by `system` and the envelope model is `server-deterministic`. With multiple allowed review focuses, an independently approved model request can choose one permitted focus; it cannot remove or rewrite the fixed limitations. That source is `model_synthesis` by `model`. Both remain unconfirmed suggestions/inferences in independent `model_completion_synthesis_left/right` fields. Existing per-angle comparisons and human review remain intact.

The repository additionally exposes two server-only capabilities:

- `verifySynthesisAncestors({credential,scope,actor,sessionId,baseRevision,inputDigest,synthesis,sourceRefs,candidateId?}) → true`. With no candidate ID, both fresh transactions require the exact current native session and recompute the complete evidence context from verified accepted artifacts. They allow only the provider's finite permitted review-focus choices. With a candidate ID, all supplied context must match the complete immutable database artifact. Only an actual database consumption receipt permits the historical-review exception; there is no caller-controlled historical mode. Neither form returns customer or candidate contents.
- `verifySynthesisAcceptance({credential,scope,actor,candidateId}) → true`. The prepared workflow's `candidateAcceptanceVerifier` calls this only after a first synthesis acceptance has committed and before returning it. It freshly checks the stored acceptance and current ancestors. If unavailable, synthesis acceptance is refused before writing. If a check fails after commit, the result is uncertain, not a claimed rollback. Historical workflow loads and exact already-committed request replay do not invoke this new-operation guard.

An ancestor must be an actually accepted `completion_comparison` with the exact database artifact and acceptance receipt. Accepted ancestor TTL expiry does not delete evidence. Explicit ancestor `active=false` does prohibit new synthesis generation/publication, pending synthesis preview and new acceptance. Publication and acceptance recheck that access within the same transaction and at the write guard; generation/preview and first acceptance delivery use fresh independent reads. Current employee, binding and all original-image authorization also remain necessary.

Within one ancestor-check call, receipt verification may reuse the exact candidate row that call has just locked. A no-ID composite check also compares the complete ordered/unique source list to the ancestor pairs whose original hashes, metadata and current access it has just checked, rather than selecting those same media rows twice. This is local duplicate-read removal, not a cache: no row, active result, credential decision, TTL result or missing-row result is reused by another call or transaction. Both fresh transactions and their final authorization checks remain. Other attached photos are still covered by the provider's separate native-session gate; the composite source-only verifier is not a substitute for that broader gate.

Already accepted synthesis history is never rewritten when an ancestor is later revoked. Exact committed replay preserves that historical result; it is not permission to generate or accept a new summary. Pure history validation reconstructs the synthesis's original native `baseRevision` and uses only previously verified accepted ancestors existing then. Later confirmations or replacement comparisons must not retroactively change its captured entry status, evidence, review focus or limits. Current media revocation can still block delivery without deleting an archive.

No table, migration, role or grant is added for synthesis. The same immutable candidate/workflow/full-archive rows and CAS/idempotency rules apply. The new checker proves stored provenance and current access only, not model quality. The unexplained earlier legacy-PG failure and the least-privilege/`FOR SHARE` design issue in `DEPLOYMENT-APPROVAL-CHECKLIST.md` remain independent deployment blockers.
