# Prepared durable approval and provider-attempt policy

Default disabled. This layer supplies code and a storage protocol, not a deployed approval issuer, secure credential service, migrated production identity system, or permission to call a provider. All supplied tests use synthetic identifiers/content, mock transport and mock approval evidence. The in-memory transaction fixture is explicitly **not durable**. Actual isolated PostgreSQL evidence must be reported separately by its integration tests.

## Composition and ownership

`createDurableProviderPolicy({enabled,repository,approvalIssuer,intentResolver})` returns `persistApproval`, `revokeApproval`, and `forRequest`.

- `persistApproval({credential,scope,requestId,evidence})` asks the trusted issuer dependency to verify an exact action-time approval. It persists only the approved receipt metadata and request binding, never the evidence token, credential, key, request body or image bytes. Approval is valid for at most fifteen minutes; reusing an existing receipt does not refresh expiry.
- `revokeApproval({credential,scope,requestId,expectedRevision,evidence})` requires the trusted issuer's revocation verification and a matching current authority. It can only revoke that exact receipt, not create a new grant or undo consumption.
- `forRequest({credential,scope,requestId})` freshly resolves immutable authority and returns per-request `{attemptStore,processingGate,transmissionGate}` closures. Do not share one mutable request closure across different requests. Inject these into the existing runner or candidate adapters; HTTP/runtime integration is separate and disabled unless explicitly configured.
- `intentResolver(disclosure)` is trusted server code, not a client JSON decoder. It must derive the exact approved intent and cost ceiling from the actual prepared content and approved quote. Missing cost, destination/model, original input digest or other mandatory binding fails closed. `modelConfig.approved` is not fee or processing consent.

There is no default issuer. A production repository must independently verify the receipt's issuance authority. A normal application role must not gain approval-signing power merely because JavaScript returned `true`. The prepared PG slice uses independently pre-issued exact receipts and context grants; its issuer operations are not ordinary runtime capabilities.

## Identity and disclosure binding

The full `design-immutable-authority-v1` tuple is resolved by trusted server code: subjectId, employmentId, membershipId, securityEpoch, membershipRevision, storeId, display actor, scoped visit/customer, and bindingRevision. The new shared strict validator checks structure only, not authority. Each transaction resolves and compares the full tuple again; its final authority guard runs after request-context/approval guards. Display username/store are retained only for audit and compatibility with old runner hashes.

The durable owner key hashes `[subjectId,employmentId,membershipId,storeId,requestId]`. Epoch and revision changes do not silently create a replacement attempt: the stored full tuple must still match. Rehiring or a new membership cannot inherit the old receipt or result solely by matching a display name.

The immutable intent contains requestId, local/external kind, operation, exact destination/model, payloadSha256, byteLength, dataKinds, purpose, inputDigest, original/derived source references, maxOutputTokens and cost. External cost is an explicit positive `maximumMinorUnits`, ISO-style currency and `one_time` commitment. The two supported external destinations are the fixed official DeepSeek chat and ASR endpoints. No model or price is guessed. Local deterministic synthesis has no external endpoint, fee approval, key use or transport.

## Transaction protocol

`repository.withTransaction(work)` supplies one same-connection transaction with:

- `resolveAuthority({credential,scope})`
- `verifyRequestContext({authority,intent}) -> true`
- `now() -> integer epoch milliseconds`
- `readApproval(ownerKey)`, `insertApproval(ownerKey,row)`, `casApproval(ownerKey,expectedRevision,nextRow)`
- `readAttempt(ownerKey)`, `insertAttempt(ownerKey,row)`, `casAttempt(ownerKey,expectedRevision,nextRow)`
- `beforeCommit(asyncGuard)`

Reads and guards must hold appropriate locks for the current identity, receipt and source grants. Insert/CAS return true only for their exact transition; they cannot silently overwrite. Commit acknowledgement loss throws rather than fabricating a result. `verifyRequestContext` is mandatory and must cover current data/source permission in the same transaction; calling a fresh nested connection can deadlock. A generic `true` is not a production implementation. The prepared synthetic PG context-permission slice does not mean all old candidate/media/key identity flows have migrated.

Approval rows use schema `design-provider-approval-v1` with ownerKey, revision, receiptId, authority, intent, issuedAt, expiresAt, active and consumedBy. The receipt ID must also be unique. Attempt rows use `design-provider-attempt-v1` with ownerKey, revision, authority, intent, legacyKey, legacyFingerprint, approvalReceiptId, state, result, createdAt and updatedAt. Only completed attempts have a result. Stored results are bounded structured runner output, not arbitrary transport responses; the runner rejects key echoes before settlement.

## One dispatch and unknown outcomes

The existing `reserve` and `settle` methods remain. New trusted optional runner hooks are `bind`, `authorizeDispatch` and `authorizeReturn`:

1. Processing approval is checked against the exact prepared disclosure. `bind` cross-checks the actual runner key/fingerprint and disclosure; those hashes alone never prove ownership.
2. `reserve` atomically creates pending, or returns the existing immutable attempt. Concurrent requests cannot obtain two new reservations.
3. After the runner's existing final gate, `authorizeDispatch` atomically verifies current immutable authority, approval, expiry, source context, and consumes the receipt while changing pending to dispatch_claimed. The runner starts transport immediately after this awaited permission with no additional await or deferred microtask. An already sent request cannot be recalled.
4. Settlement uses CAS. External completed requires dispatch_claimed; claimed cannot become not_sent. Pending/claimed can become uncertain. Terminal results/tombstones cannot be overwritten or reset by expiry.
5. A lost reservation/claim/settlement acknowledgement is uncertain. A crash after claim may have sent or billed even without a response. Reconstruction reads the same request; it never creates a new request ID or re-dispatches pending, claimed, uncertain or not_sent.
6. Completed replay does not retrieve the old key or call transport, but still runs fresh authority, approval/revocation and source checks. Result retention is not permission to disclose it. Post-send revocation may withhold the result while leaving its committed completed tombstone intact.

No-policy legacy mock stores retain their existing behavior. Deterministic local candidates share the immutable request ledger, making local-to-model and model-to-local reuse with changed input a conflict. They do not consume a paid receipt.

## Validation evidence and remaining boundaries

The pure policy suite exercises strict identity/cost contracts, one reservation/claim, concurrent requests, simulated commit acknowledgement loss, reconstruction, TTL and revocation, epoch/source changes during final guards, key-free replay, terminal-state immutability, local/external conflicts, and untrusted approval/getter rejection. The shared real provider runner is used with synthetic transport for dispatch and replay cases. Old candidate-provider and synthesis pure suites must continue passing.

This does not prove production issuer authenticity, actual provider billing limits, secure key storage, real model support, production database deployment, or complete migration of legacy identity flows. Do not report the mock repository as a crash-durable database. Actual PG durability and non-owner capability checks require separate isolated integration evidence. No production credential, data, permission or deployment is configured by these modules.
