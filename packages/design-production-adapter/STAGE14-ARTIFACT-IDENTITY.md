# Stage14 immutable access sidecar for existing artifacts

Local preparation only. This is a **read-only compatibility gate**, not a migration, new archive format, identity issuer, SQL repository, production route or permission grant. It is not installed into `prepared-runtime.mjs`. Default-disabled behavior and every existing source/media/ancestry authorization check remain intact.

## Why a sidecar

Current private-media bindings/storage locators use `{owner: username, store, scope}`. Candidate actors, request-derived IDs and acceptance receipts retain username/store. Workflow and full/legacy version authors are also part of immutable original content and hashes. Replacing these fields with today's immutable principal would alter history and could falsely assign another person's work.

`artifact-identity-compatibility.mjs` leaves these representations unchanged. A separate, independently issued **current reader access attestation** pins an exact original artifact and an immutable reader identity. It does not establish historical authorship. Matching a current name/store, a hash, a client-supplied claim or an opaque receipt ID is never sufficient authority.

Only `authorship.status: 'unresolved'` is supported in this stage. `legacyActor` retains the original envelope author's text; all nested source labels and historic author fields remain original and unresolved as well. No author, source, confirmation, plan/actual value, photo reference or old digest is rewritten. A separately approved reader may access an explicitly attested artifact without being declared its creator. Without that exact independent issuance, username reuse, rehire, store transfer or the same display name confers no access.

## Composition interface

```js
const access = createArtifactIdentityCompatibility({
  enabled: true,              // trusted server config, default false
  repository,                // independently controlled, currently not implemented for PG
  issuer,                    // independent verifier, no default approval
  readers: {
    media: {read: r => existingMedia.read(r),
            resolveReferences: r => existingMedia.resolveReferences(r)},
    candidate: {load: r => existingCandidateService.load(r)},
    history: {load: r => existingRepositories.loadFullArchive(r)}
  }
});
```

The four reads accept the unchanged actor-free requests:

- `access.media.read({credential,scope,approval,mediaId})`
- `access.media.resolveReferences({credential,scope,approval,mediaIds})`
- `access.candidate.load({credential,scope,candidateId})`
- `access.history.load({credential,scope})`

They return the unchanged original reader payload, not attestation records, an authority token or a new identity claim. Media reads return a fresh byte copy with `private, no-store` and zero max age. No signed URL is created. Callers cannot submit an artifact, digest, reader identity, model, URL or attestation through these requests.

`media.upload`, candidate publication/generation/acceptance methods and `history.append` explicitly throw `ARTIFACT_WRITE_DISABLED`, including when the factory is otherwise configured. Do **not** spread these methods over a complete runtime while retaining old write routes. A future entry point must be explicitly read-only. Missing repository, independent issuer verifier or selected reader rejects before any dependency I/O; there is no legacy-name fallback and no automatic retry.

## Original artifact and attestation contracts

The trusted repository, not the request, returns a fixed ordered array of source items:

```text
{kind, id, version, scope, payload}
```

- `private_media`: `id=record.mediaId`, `version=1`, payload is the existing complete private metadata record, including original binding and source-byte SHA-256. Its current access must be active. Reference-only public JSON is not sufficient.
- `candidate`: `id=candidate.id`, `version=1`, payload is the complete original candidate envelope. The existing candidate service still validates native context, source refs, acceptance/ancestry and current access.
- `full_version`: `id=version.requestId`, `version=version.version`, payload is the complete original full-version envelope. Every version is present in ascending chain order. The existing full-chain validator and existing repository source/photo/receipt checks still apply. An empty history is deliberately denied by this initial compatibility slice rather than treated as attested access.

`describeIdentityArtifact(item)` produces:

```text
{kind, id, version, scope, sha256}
```

The digest is SHA-256 of UTF-8 `design-artifact-access-content-v1\0` followed by canonical JSON of the **entire source item**, including payload. It is a new domain-separated consistency fingerprint, not a replacement for any existing digest or evidence of permission. Its structural helper has no I/O and grants nothing.

Each descriptor must match exactly one independently issued attestation:

```text
{
  schemaVersion: 'design-artifact-access-attestation-v1',
  id, revision, issuerId, active, issuedAt, expiresAt,
  artifact: {kind,id,version,scope,sha256},
  reader: {subjectId,employmentId,membershipId,storeId,
           securityEpoch,membershipRevision,bindingRevision},
  authorship: {status:'unresolved',legacyActor:{username,store}}
}
```

Times are integer Unix milliseconds; issuance must already be effective and expiry still in the future. IDs, exact fields and positive revisions are checked. The reader tuple is derived from freshly resolved `design-immutable-authority-v1`, not actor labels. `artifactReaderIdentity(authority)` is structural extraction only. Missing, duplicate, revoked, expired, future, changed or mismatched proofs deny. `issuer.verify` must independently establish that this exact record came from an approved issuer; a self-consistent artifact plus recomputed proof hash still cannot grant access.

## Required transaction dependency, not a mock safety claim

`repository.withReadTransaction(work)` must keep one connection and protected locks from resolution through its guards/COMMIT. Its transaction object supplies:

```text
resolveAuthority({credential,scope})
loadArtifacts({operation,scope,ids})
readAttestations({artifact,reader}) -> [] | [one exact record]
now() -> database time in integer milliseconds
beforeCommit(asyncCheck)
```

Operations are fixed `media_read`, `media_references`, `candidate_load`, `history_load`. Non-history source order must equal requested IDs; no duplicates are allowed. The repository must load authoritative original artifacts and live access/attestation rows, not values carried in from a caller. A caller's JSON object, matching digest or claimed issuer is not an independent source. Runtime must not be able to issue/reassign these attestations.

The wrapper performs a fresh transaction before the old reader, pins the complete ordered artifact set/proofs/authority, executes that reader outside sidecar locks, validates its result against the pinned authoritative originals, then performs a second independent fresh transaction. Each transaction repeats checks in `beforeCommit`; skipped/repeated transaction callbacks or skipped guards fail. The final clock/expiry check follows the final authority await. The transaction context cannot escape its callback.

`issuer.verify(proof,{authority,artifact,reader,transaction})` establishes **independent issuance authenticity**, not a caller's approval flag. Current attestation revocation must come from the locked live attestation rows. If issuer trust itself is mutable, its authoritative state must also be read and locked in that same transaction; an unrelated external issuer/revocation endpoint is not magically protected by those DB locks. No external issuer wait or live revocation integration is configured or accepted here.

Private bytes must be a bounded `Uint8Array` of 1 byte through 8 MiB; a single copy is checked against trusted original byte length, SHA-256, magic/MIME and all returned reference fields. Magic checking is not a decoder: the unchanged existing media reader must still perform its full image validation. Candidate output must equal the entire pinned candidate. Full history must equal all pinned versions and their exact head. A changed head or even a valid but different generation is rejected, not merged.

The JSON budget is 64 MiB plus 64 KiB envelope, with bounded depth/nodes and smaller request/proof limits; full-chain/candidate native limits remain in force. Getter/proxy/exotic-property input is rejected without invoking it. Errors expose only fixed safe codes, no credentials, source content, SQL or dependency errors.

**Important limits:** lock/issuer independence is a required dependency contract, not proved by the in-memory test fixture. No PG sidecar schema, RLS policy, issuer API or producer writes exist here. No source provenance becomes trustworthy from a checksum alone. A result represents access at its final successful transaction check; it is not a permanent permission token. The Stage13 arbitrary-SQL `SET CONSTRAINTS ALL IMMEDIATE` expiry bypass is not repaired by this wrapper. No physical-byte-delivery atomicity with later revocation is claimed. Production needs the reviewed broker, driver/role, expiry and issuer boundaries independently accepted.

## Verification and limits

Run `node --test scripts/test-design-artifact-identity-compatibility.mjs`.

Author verification on 2026-11-15: **28/28** passed, plus module syntax and `git diff --check`. This count includes the final-authority-await expiry regression, concurrent duplicate guard rejection and safe error reconstruction; it is not actual PostgreSQL sidecar acceptance.

The suite directly composes the existing `createPrivateMediaService`, `createDesignCandidateService` and public `createDesignPostgresRepositories(...).loadFullArchive` facade. Lower repository transactions, issuer, object transport, original source rows and fixed-PNG inspector are synthetic mocks. It does not run PostgreSQL, Docker, a browser, a native decoder, a real microphone, a secret manager or a model. The actual full-history facade and native chain validation retain two nonempty full versions and a populated legacy author record; these are not empty-table compatibility assertions.

Cases cover same-alias different principal, rehire/membership/epoch changes, independent reader access without author reassignment, absent/revoked/duplicate/expired proofs, self-consistent forgery, mutable/getter/proxy input, old gates denying access, output/byte substitution, both fresh passes and final guard revocation, head changes, immutable content and explicit write refusal. An initial fixture used a non-Supabase synthetic object origin and was correctly refused by the existing storage adapter; changing only that mock origin to the supported fixed synthetic host allowed the actual read path to run. Product restrictions were not widened.

This is **not** completion of all identity consumers. New uploads, candidate generation/adoption, workflow writes, new archive appends, historical author attestations, cross-employee access policy/issuance, production issuer/repository and full-runtime installation remain pending. Production remains disabled.
