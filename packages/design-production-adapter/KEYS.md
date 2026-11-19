# Prepared employee key settings (disabled)

Optional prepared key-settings routes exist in `http-handler.mjs`, and `prepared-runtime.mjs` can receive an explicitly injected `keySettings` adapter. They are disabled/unavailable without that independent configuration; they are not a deployed or usable secure-input flow. Production secure input, trustworthy action-time approval issuance and the real employee-key repository remain unimplemented/unconnected. This code creates no account, API credential, encryption secret, persistent grant, network request or provider charge. The public loopback synthetic UI must never collect real keys. Do not request keys in chat or place them in URLs, localStorage, logs or test fixtures.

## Trust boundary and setup

`createPreparedDesignKeySettings` defaults to `enabled:false`. It needs all of:

- `authenticate(opaqueCredential)`: trusted existing employee-session verifier returning `{username,store,active,expiresAt}`. Never accept the public synthetic actor header or client identity claims. Current key ownership is `username + store`; activation requires technical proof that the username permanently identifies the same person and is never recycled. A unique constraint does not prove this. If names can be reused or employees move stores, first review an immutable employee-ID and key-ownership migration/revocation design. An old employee's key must never pass to a new employee with the same username, and store reassignment does not grant access to another store's key. Providing an API key cannot replace this identity review.
- `approvedModels`: explicit server-maintained model identifier list, empty by default. No guessed/current-default model is enabled. Chat destination is exactly `https://api.deepseek.com/chat/completions`. Optional `allowASR:true` enables only `https://api.deepseek.com/v1/tools/asr` with `model:null`; this must have separate approved capability configuration. Official ASR reference: https://api-docs.deepseek.com/api/asr/ . No arbitrary base URL, redirect, proxy or owner/system fallback.
- `approvalVerifier.consume(receipt,intent)`: a trusted action-time approval verifier, not a boolean supplied by the browser. Atomically validate and consume a unique, short-lived, non-replayable approval bound to the authenticated employee/store, action, purpose (`chat` or `speech`), exact destination, model, expected revision, and SHA-256 `keyDigest` of the exact supplied key (null for revocation). Receipt expiry, signature, issuance origin and single-use semantics belong to this adapter. False/errors fail closed. Approval consumption may succeed even if a later save fails; the user must reapprove rather than blindly replay. The digest is sensitive metadata: never log or expose it. Saving an existing credential creates persistent access and needs this per-action approval; plain chat consent does not bypass it.
- `sealer`: `{digest,seal,open}` using the server-only `createDesignKeySealer({secretProvider,cryptoProvider})` implementation or equivalently reviewed implementation. `secretProvider({purpose:'design-employee-key-v1'})` must supply a dedicated existing 32-byte secret from a trusted secret manager. Never reuse voucher encryption secrets, voucher provider keys or an owner key. No default environment lookup is provided. Provisioning/rotating secrets is a separate approval-requiring operation, not performed here.
- `repository.withEmployeeLock({username,store}, callback)`: a trusted bounded exclusive lock/transaction for that exact employee+store, shared by reads, writes, revocation and provider use. Callback receives `{read,compareAndSwap}`. `read(purpose)` returns null or the exact record for that employee+store+purpose. Records include `purpose`. `compareAndSwap(expectedRevision,next)` must atomically return true only for the matching revision, identity and `next.purpose` slot; otherwise false. Never expose a table-wide owner lookup. A real adapter must implement actual locking/CAS and account-revocation coordination, not just a JS process-local mutex.

AES-256-GCM uses a fresh 96-bit IV from injected cryptographic randomness for every seal. Versioned, unambiguous JSON AAD binds employee, store, destination, model and record revision. Never use the fixed synthetic test nonce/material outside tests. Secret rotation needs a separately reviewed key-version migration; no silent fallback is allowed.

## API

- `status({credential,purpose})` returns only `{configured,revision,destination,model}`.
- `save({credential,approval,expectedRevision,config:{destination,model},key})` accepts the key only from an authorized secure server-side entry flow, seals it, rechecks employee identity before CAS and returns metadata only.
- `revoke({credential,approval,expectedRevision,purpose})` removes ciphertext and leaves a revision tombstone. Old saves cannot resurrect it using revision zero. Database backups/history retention and vendor-side key cancellation require separate operational handling; this is application revocation, not a claim to cancel the key at DeepSeek.
- `withProviderKey({credential,expectedRevision,destination,model}, use)` is **internal server-only**, not a settings HTTP endpoint. Inside the employee lock it checks exact configuration, decrypts for the trusted bounded provider callback, then checks employee and record again before delivering the callback result. It cannot erase immutable JS strings or cancel a provider request that has already started. Revocation waits for an already running locked dispatch, and blocks later dispatches; integration must set bounded provider timeouts. Recheck alone cannot atomically coordinate external employee deactivation with an external network call.

Provider integration `keyResolver({credential,actor,scope,provider,destination,model}, useKey)` should obtain expectedRevision from trusted server configuration/status for the destination’s exact purpose slot, call `withProviderKey`, compare `lease.actor` to the permission-gate verified actor, then invoke `useKey(lease.key)`. Do not return the key to the client. The callback must return only a separately validated provider result; it must not return/log the lease or key. Customer/visit permission, data transmission authorization and per-request payment authorization are separate provider gates. A saved key never authorizes calls or data sharing by itself.

Chat and speech have independent slots per employee+store, independent revisions and separate exact approvals. Saving or revoking speech never replaces chat. Save/provider infer the purpose solely from the allowlisted destination; status/revoke require explicit `purpose: chat | speech`. No key is copied or reused between slots. Status/revoke permit structurally valid retired models or disabled capabilities so old credentials can still be removed; save/provider additionally require the current explicit model/capability allowlist. Missing/disabled/revoked configurations deny provider access, with no fallback.

## Verification

`node scripts/test-design-key-settings.mjs` uses only conspicuous fixed synthetic strings, in-memory repositories/approval receipts and injected test crypto. No real credentials or accounts are generated, no persistence is configured and external fetch is forbidden. Production integration still needs secure entry, authenticated transport/CSRF defenses, approval issuance, transactional database integration, secret management, retention/rotation and integration review before enabling.

## Proposed secure input, not an available page

Prefer a dedicated, narrowly controlled settings page or approved secure handoff, separate from the large general App DOM and every public/synthetic demonstration page. Do not send an input link until that page and its server path are implemented, reviewed and explicitly enabled. The proposed boundary is:

1. Verify the existing employee session and stable ownership server-side. Show only the identified account/store, purpose, exact approved provider destination/model and current settings revision. Do not accept identity fields as authority or offer an owner/global fallback.
2. Use trusted HTTPS with an exact reviewed origin, a restrictive CSP, no third-party JavaScript, analytics, session replay or unrelated App scripts. No secret in URL/history, browser persistent storage, service-worker/cache entries, proxy/body logs, error reports or returned responses. The server and any reverse proxy must enforce no-store and logging redaction; hiding a password input is not sufficient.
3. At the action itself, disclose that this stores an employee-specific provider credential for future separately authorized calls. The owner approves the exact account/store, purpose, destination, model and revision. Trusted approval issuance must bind a unique short-lived one-use receipt to those fields and the exact `keyDigest`, then `save` recomputes it and consumes that receipt. The digest itself must not be displayed, logged or exposed. A browser boolean, a pasted chat key or an earlier broad approval cannot substitute for this receipt. The issuance/secure-form design is still to be implemented and must not introduce an unapproved hidden pre-save.
4. Seal only on the reviewed server path with the separately approved dedicated secret and repository. Recheck employee identity and CAS before saving. Return configuration metadata only and clear the form on completion, cancellation, expiry or identity change. JavaScript strings cannot be reliably erased, so minimize lifetime and copies rather than claim guaranteed memory wiping.
5. Do not test the key by making a paid provider call automatically. Key storage, private-data transmission and a billed request are separate permissions. A save failure or consumed approval requires explicit readback/reapproval, not a new silent retry. Application revocation does not cancel the vendor-side key.

Suggested approval wording, with every placeholder resolved before use: “Store the credential entered in this secure form for [verified employee] at [store], purpose [chat/speech], destination [exact provider endpoint], model [approved model], replacing settings revision [revision]? This enables persistent credential storage only. Customer-data processing and charges still require their own approval.” Never ask the owner to paste the credential into that approval text or this chat.

## Stage14 immutable membership preparation (not deployed)

`createImmutablePreparedDesignKeySettings` is a separate default-disabled entry in
`key-settings.mjs`. Legacy methods and v1 ciphertext are unchanged; the new entry
never reads a legacy slot or tries a v1 decrypt. No migration or identity inference
from username/store is provided.

`resolveIdentity({credential})` and the repository's same-transaction
`tx.resolveIdentity({credential})` must return the exact structural contract in
`immutable-key-identity.mjs`: schemaVersion `design-key-identity-v2`, subjectId,
employmentId, membershipId, storeId, securityEpoch, membershipRevision, expiresAt.
The resolver establishes identity from the server session, not client-selected
membership. No customer or fabricated visit is needed. The structural validator
alone establishes no authority. Epoch and membership revision changes require
explicitly approved reconfiguration before decrypt; status can disclose that
reconfiguration is required. A fresh approval can revoke the old own slot.

Methods keep the legacy input shapes, with no scope parameter. The new repository
must provide `withIdentityLock(identity, work)`, and its transaction provides
`read(purpose)`, `compareAndSwap(expectedRevision,row)`, `resolveIdentity`,
`consumeKeyApproval({receiptId},exactIntent)`, and
`beforeCommit(guard)`. It must hold the slot lock through the bounded callback,
run guards before COMMIT, rollback failed transactions, and never auto-retry an
unknown outcome. A write attempted without a known successful return is reported
conservatively as `KEY_OUTCOME_UNCERTAIN`; reconcile metadata instead of resending.
This is not proof of absolute identity validity at network arrival or COMMIT.

The v2 sealer uses dedicated secret-provider purpose `design-immutable-key-v2`.
AAD binds subject/employment/membership/store, securityEpoch, membershipRevision,
purpose, official destination, model and record revision. Session expiry is checked
fresh, not encrypted into the enduring slot. Chat/speech remain separate slots.
Approval binds precisely that immutable identity, action, slot/config/revision and
key digest. The receipt must be pre-issued by an independent trusted issuer, not a client
boolean. Stage15 requires the repository to consume that exact receipt in the
same transaction as the key CAS. Missing transactional consume rejects; there is
no fallback to the legacy independent approval verifier.

Provider `withProviderKey` leases include immutable `identity`, never a legacy
actor surrogate. A trusted integration must bind this identity to the provider's
independently verified membership. Customer/media gates, disclosure and cost
approval are still mandatory; a key lease cannot replace them. Callback outputs
must be separately validated and must never contain the key. JS key strings cannot
be securely erased. Existing provider/HTTP routes are not silently switched over.

Tests use an isolated in-memory repository and conspicuously synthetic key bytes,
plus actual local WebCrypto AES-GCM with a fixed test-only IV. Never reuse this
fixed-IV mock in deployment. No real key repository, production issuer, secure
input deployment, secret provisioning or production permissions were configured.

Stage14's independent v2 approval-consume dependency has been removed in Stage15.
V2 mutations now require exact `{receiptId}` and `tx.consumeKeyApproval` on the
same connection as the slot CAS, with rollback of both on failure. Ordinary runtime
must only consume independently pre-issued receipts, never mint them. This contract
and the in-memory tests alone do not prove a production repository or issuer exists;
actual restricted-role PG evidence is tracked by the repository's separate tests.
Legacy v1 behavior is unchanged. No production deployment or secret setup occurred.
