# Stage17 dependency publication review

Baseline: 514573a2 / v672. Design review only; not a certification of complete
identity migration. This reviewer ran no Stage17 database or synthesis workload.
The separately authorized v673 app-shell run passed 15/15 with browser/server cleanup;
it is not evidence for dependency migration. Root owns final isolated integration evidence. All real deployment, data, keys and paid calls
remain out of scope.

## Existing source contracts to preserve

| Table | Immutable content / linkage | Separate mutable control |
| --- | --- | --- |
| workflow_versions | scope_key, revision, record, sha256, previous_sha256, receipt_key | none |
| workflow_receipts | request_key, receipt, record_sha256 | none |
| media_records | binding_key, media_id, record, record_sha256 | media_access(binding_key,media_id,active,revision) |
| model_candidates | candidate_id, scope_key, envelope, sha256, expires_at | model_candidate_access(candidate_id,active,revision) |
| model_candidate_acceptances | candidate_id, receipt | none; consumption is immutable |
| full_versions | scope_key, version, record, sha256 | none |
| full_receipts | request_key, receipt | none |

Stage16 operation_authors bind workflow revision/receipt/hash/predecessor and full
immutable authority; its independently issued manifest binds an exact legacy base.
New media/candidate/full author evidence must be additive and equally immutable.
Old owner names, source bodies, receipts and hashes must not be rewritten. Existing
scope-only lookup or a current same-name employee is never identity inheritance.

Media record has mediaId/requestId, binding(owner/store/scope), stage/angle, mime,
byteLength, width/height, original sha256 and immutable active=true. Live revocation
lives separately. Candidate envelope binds native session baseRevision/inputDigest,
kind/model/prompt, exact sourceRefs and accepted provenance. Full version embeds a
validated snapshot, previous digest and author/request metadata. Do not substitute
browser-supplied candidate JSON or snapshot for the authoritative stored source.

## Exact atomicity boundaries

### Private originals

Reuse `private-media-service.mjs` two-phase composition: obtain exact upload approval,
validate/decode bounded original bytes, stage an immutable object outside any database
transaction, then enter metadata publication. Do not reuse the old storage bridge's
network-inside-metadata-lock behavior.

Within the publication transaction: resolve immutable authority on the same connection;
lock the scope/source/base; compare all previously read records; validate exact record,
original hash and scope; insert record + initial access + author/request evidence;
run final same-transaction permission/approval guards; commit. Post-commit fresh checks
precede reference delivery. Storage staging and metadata are not one transaction.
Failed metadata publication can leave an orphan. Unknown outcome cannot justify
blind deletion, re-upload under a new ID, or claiming nothing was written.

Read original bytes outside transaction, with exact metadata/hash checks and fresh
permission after I/O. A metadata reference grant is not a bearer URL, external model
processing approval or permission to transmit original EXIF. The controlled derivative
worker and its production isolation remain independent blockers.

### Candidates and consumption

Model/provider work occurs outside database locks and is governed by an independent
exact disclosure/cost receipt and durable one-dispatch claim. Publication transaction
checks current native base/digest, all attached active originals and derivation hashes,
immutable actor, comparison stage/angle and synthesis ancestry. Insert envelope/hash,
initial access and immutable author evidence together. Reusing an ID must preserve the
same envelope and original expiry, not renew it.

Candidate acceptance must atomically write workflow version + workflow receipt +
candidate acceptance + operation-author evidence. It must load the immutable candidate
inside that same transaction and rebuild selected entries, not trust client payloads.
A failed CAS cannot leave consumed candidate state. A lost COMMIT reply is uncertain;
replay reconciles the exact committed receipt rather than generating/charging again.

Keep the existing distinction: pending candidate needs current base and TTL; accepted
history can retain expired candidate artifacts. Revoked ancestors forbid new synthesis
and pending synthesis access/acceptance, while already accepted history retains its
original provenance. That exception must be determined from database consumption,
never a caller boolean. First acceptance still needs its post-commit fresh check.

### Full publication

Resolve current server workflow and compute its full snapshot. Within the same fixed
publication transaction, match the exact latest source snapshot, immutable scope/author,
all attached original photos, candidate acceptance/history links, full parent digest,
expected version and request receipt. Insert full version + receipt + immutable author
sidecar atomically. Native archive intent and full-version publication are different
operations. Full-history reads validate each historical source without treating it as
new current-base authorization.

## Manifest expansion without a bypass

Removing Stage16 text_only rejection alone is unsafe. The expanded authoritative
bundle must include every referenced media/candidate/full source and acceptance link,
with exact hash and immutable owner evidence. Manifest baseline binds immutable source
content; separate access rows remain freshly authoritative and cannot be cached as
permanent permission. Preserve old base snapshot/prefix proofs while allowing only
properly author-attested new suffix operations. New publication cannot make an old
unattested artifact appear trusted merely by attaching it.

Global lock ordering must remain consistent across legacy and new supported writes,
issuer/revocation paths and source reads. Same-transaction gate methods must not open
another connection. External provider/storage/decoder and interactive approval waits
must not run while holding those database locks. Every exported route graph must use
only the migrated capabilities; missing dependencies reject, never fallback to legacy
raw-table roles or generic executeSQL.

## Per-route dependency closure

- media/upload: membership + visit + upload approval + decoder + immutable storage
  + metadata/access/author publication + final fresh access.
- media/read/references: exact source metadata, immutable ownership or independent
  legacy access evidence, live revocation, purpose approval; bytes read only for read.
- candidate/extract: current native human evidence, exact paid disclosure, immutable
  request ledger and candidate publication. No accidental model/system quote export.
- candidate/vision and compare: attached originals, appropriate phase/stage/angle,
  approved derivative and independent external processing/cost, then publication.
- candidate/synthesize: explicitly accepted per-angle evidence, live ancestor rules;
  deterministic branch must still make zero key/model/paid-approval calls.
- candidate/load and workflow accept_model_candidate: current/historical-consumption
  rules, exact sources, and the atomic acceptance graph described above.
- workflow attach_media: same-transaction verified metadata, never browser references.
- archive/full and archive/full/load: exact native source, complete dependency chain,
  full receipts and immutable authors. Legacy archive writes remain separately scoped.
- analyze/speech, key settings, visit lists/resolution: do not silently assume these
  unrelated route graphs were migrated by enabling media/candidates/full publication.

## Fail-closed acceptance limits

Keep existing exact schemas, bytes/pixels/frames limits, native revision/chain counts,
provider response bounds and default-disabled factories. Bound the total assembled
bundle, not just each class of source rows separately. No unbounded join/aggregation
or parser-memory claim from a post-parse size check. No increase of timeouts to pass.

Isolated tests should cover same-name rehire, reassignment, revocation at each await,
wrong original/derived hash, cross-scope attachment, comparison angle mismatch, stale
base, missing manifest, corrupt author/receipt/hash, orphan staging, lost commit,
concurrent duplicate publication, atomic consume rollback and exact replay. Full
archive must preserve original bytes/hashes and distinction of human/model/system
sources. Passing those tests does not establish a production issuer, secure key input,
Linux decoder isolation, real model support or complete deployment migration.

## Actual implementation review checkpoint

Read the Stage17 fixed SQL capabilities, dependency repository and runtime. The
HTTP generation routes are closed: legacy alias-keyed provider ledger/key ownership
is not migrated. Candidate load and ID-based explicit acceptance remain separate
from backend-only synthetic candidate publication.

SQL locks media and candidate access alongside original rows. The manifest retains
immutable dependency digests while comparing live access separately; new consumption
requires an exact native acceptance lane and operation-author proof. This relies on
the shared global lock across supported writers, not arbitrary out-of-contract SQL.

Two concrete JS review findings were relayed to the author and are now corrected in
the inspected source: unconsumed candidate preview requires its full immutable author,
not only same-name actor plus manifest; consumed synthesis history does not force
current ancestor activity, while first acceptance still does. These corrections have
not been independently exercised by this reviewer. No production permission, issuer,
provider identity migration or Linux decoder isolation is certified by this review.
