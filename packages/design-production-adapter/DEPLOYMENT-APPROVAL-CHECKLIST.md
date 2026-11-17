# Deployment approval checklist: review draft only

Stage 11, 2026-11-15. This document inventories the prepared implementation and proposes the decisions and evidence required for a future deployment. It is **not an approval, migration, grant script, installation plan to execute, or activation record**. All boxes start unchecked. A blank placeholder blocks the corresponding action. No real credential belongs in this document.

The current local work does not deploy a server, configure a connection, create roles or credentials, apply DDL/RLS, enable storage/model traffic, or authorize a live trial. Providing an API key, approving this document, or passing synthetic tests cannot substitute for the separate approvals and technical gates below. The historical intermittent PostgreSQL `RELATIONSHIP_UNAVAILABLE` failure remains an unresolved pre-live blocker despite later passing runs. This review does not rerun it or declare it fixed.

## 1. Separate authority from readiness

Keep two independent records for each proposed action:

- **Owner authorization:** exact target, change, data, recipient, purpose, cost/commitment and any applicable action-time confirmation. A design review is not authorization to execute it. Creating or configuring credentials for persistent access, expanding security-sensitive access, and transmitting secret keys require their applicable per-action confirmation. A key supplied in conversation is not a secure-entry or persistent-access approval.
- **Technical acceptance:** named reviewer, exact artifact/configuration revision, isolated evidence and remaining limitations. A user saying “allow it” cannot prove stable employee identity, safe RLS, decoder isolation, an understood failure or a reliable deployment. Unmet safety/technical conditions remain blocking.

Customer consent is a separate requirement from either record. Owner-only access does not authorize another person's recording, photograph, external processing, training use or later employee rollout. Existing employee sessions authorize only the relationships freshly verified by the application; they are not general database access.

## 2. Current implementation inventory

Sources of truth are [postgres-executor.mjs](./postgres-executor.mjs), [postgres-workflow-repositories.mjs](./postgres-workflow-repositories.mjs), [prepared-runtime.mjs](./prepared-runtime.mjs), [key-settings.mjs](./key-settings.mjs) and their existing module documents. The following describes actual statement families, not permissions already installed.

### Existing business tables: reads, not source management

The executor uses fixed parameterized SQL and shared row locks. These are the columns referenced by its direct source queries, including predicates and ordering:

| Existing `public` table | Direct query dependencies | Business capability required |
| --- | --- | --- |
| `employee_booking_sessions` | `token_hash,username,store,position,expires_at` | Exact hashed-session lookup and database-time expiry check. No session creation, renewal or revocation write. |
| `staff` | `username,store,position,active,employment_status` | Current employee/target stylist validation. No employment, identity, role or store update. |
| `bookings` | `id,barber_name,shop_name,date,status` | Exact appointment and bounded employee/store/date locator list. No appointment or assignment mutation. |
| `frontdesk_today_customers` | `id,barber_name,store,business_date,status` | Exact frontdesk visit and bounded employee/store/date locator list. No arrival or assignment mutation. |
| `customer_profiles` | `id,name,shop_name,card_packages,service_history` | Stable profile/home-store and minimal authorized display/history reads. Even the non-name `id,shop_name` translator currently selects `card_packages,service_history`; do not describe it as a two-column database grant. No profile mutation. |

The list is limited to a combined 50 scanned locators and rejects overflow. It does not grant browsing rights to every customer. Binding, current source assignment, lifecycle, staff and session must agree; names and phone numbers do not establish the new binding.

Legacy initialization also reads `public.customer_design_versions` and `public.customer_design_assets`. The history-size query uses `to_jsonb(v)` on the complete legacy version row, while projection reads scope, authorship, request/version/parent identifiers, timestamps and all supported snapshot fields. Asset lookup uses `id,customer_profile_id,visit_key,store,stage,angle`. Thus a minimal projected SELECT grant alone is not enough for unchanged legacy code. Existing business DDL is only partially represented in repository fixtures; these column lists do not certify the target's full schema, grants or policies.

### Private contract: exact read/write families

Every table below is in the **uninstalled** `design_private` contract. `drafts/stage6-executor-fixture.sql`, `stage7-workflow-fixture.sql` and `stage8-candidate-fixture.sql` exercise it only in a guarded disposable database. They must not be copied into automatic migrations.

| Table(s) | Current executor/repository operation | Required restriction in a future design |
| --- | --- | --- |
| `runtime_contract`, `workflow_contract` | Locked singleton version read | Runtime cannot insert/update/delete markers or disable guards. |
| `binding_versions`, `binding_requests` | Locked history/receipt read; binding adapter atomically inserts a revision plus receipt | Immutable rows; unique request and revision constraints; no history update/delete. Ordinary workflow does not establish or change bindings. |
| `binding_authorities` | Locked exact `(username,store,action)` read for binding management | Runtime cannot grant itself `bind/reassign/revoke/restore`; independent management writes. |
| `binding_approvals` | Hash lookup `FOR UPDATE`; conditional `UPDATE consumed_request_id` from null; receipt recheck | Runtime consumption only. No approval issuance, intent/deadline edit, unrevocation or token reuse. Separate issuer/revoker. |
| `lifecycle_decisions` | Locked read of exact source/visit digest, allowed flag, policy revision and expiry | Runtime cannot issue, prolong or relax lifecycle decisions. Independent authoritative issuer. |
| `commit_checks` | Insert generated audit UUID and earliest authority deadline; read returned ID | Immutable rows and enabled initially-deferred deadline constraint trigger. No runtime update/delete/trigger change. |
| `workflow_versions`, `workflow_receipts` | Bounded locked chain/receipt reads; initial revision insert; CAS append plus receipt | Immutable full-record chain and original intents; no overwrite, reset, delete or request reuse. |
| `full_versions`, `full_receipts` | Bounded locked chain/receipt reads; CAS append plus receipt | Immutable versions, parent digests and request receipts; no flattening into legacy format. |
| `media_records` | Locked exact binding/media read; immutable metadata insert | No image bytes, object path, filename or URL in this table. No update/delete. |
| `media_access` | Locked read; initial `active=true,revision=1` insert | Current repository has no revocation writer. Separate reviewed revoker may only apply the defined monotonic state change; no revival/delete/recycled IDs. |
| `model_candidates` | Locked metadata/envelope read; server-owned immutable insert | Exact actor/scope/session/media provenance and explicit TTL. Browser cannot publish candidate JSON. |
| `model_candidate_access` | Locked read; initial `active=true,revision=1` insert | Revocation managed separately; no revival/delete/recycled IDs. |
| `model_candidate_acceptances` | Locked read; insert once during workflow acceptance | Immutable acceptance receipt, atomic with workflow revision and receipt; no update/delete. |

The executor also begins one exclusive `READ COMMITTED` connection, sets local timeouts and `pg_catalog` search path, obtains the coarse transaction advisory lock, reads `clock_timestamp()` and checks the deadline trigger through `pg_catalog.pg_trigger`. It commits only after final guards. It neither creates schemas nor supplies generic browser SQL. `readTransaction` forbids application writes but still obtains row locks; it is not a PostgreSQL transaction declared `READ ONLY`.

### Legacy RPC dependency is larger than two EXECUTE grants

The only direct public RPCs allowlisted by the executor are:

- `public.customer_design_resolve_context(bigint,bigint,date,text)` from `supabase/migrations/20261108052541_customer_design_archive.sql`. It is `SECURITY INVOKER`; internally it reads profile `id,name,phone,shop_name` and booking `id,customer_name,customer_phone,shop_name,date`. Those extra name/phone fields are legacy consistency checks; the executor discards them from the returned context. They are not replacement binding authority.
- `public.append_customer_design_version(jsonb,text,text)`, with the later definition in `supabase/migrations/20261108124519_customer_design_six_zone_execution.sql`. It is also `SECURITY INVOKER`; it calls the context function and `customer_design_private.model_document(jsonb)`, `execution_document(jsonb)` and `optional_text_document(jsonb,text[],boolean)`. It reads complete legacy version/asset rows, verifies photo scope, uses its own request/visit advisory locks and inserts a legacy version with generated UUID/time defaults. No legacy asset registration, ingestion-grant issuance or asset upload RPC is required by this executor.

An invoker needs the underlying table/schema/helper-function permissions, not only permission to call the outer function. The tracked legacy migrations grant some access to `service_role`; that historical fact is **not** a proposed runtime identity or evidence of least privilege. Do not reuse a service-wide key, switch to a table owner, or add `BYPASSRLS` to make this path work. [PostgreSQL function security](https://www.postgresql.org/docs/17/sql-createfunction.html).

## 3. Minimum-capability proposal, not installed roles

Names below identify review responsibilities, not existing PostgreSQL roles. Exact SQL role names and memberships remain `[TO BE REVIEWED]`. Runtime identities must be non-owner, non-superuser, without `BYPASSRLS`, schema creation, role administration, trigger alteration, unrestricted SQL or access to unrelated business tables.

| Proposed server capability | Only required authority | Explicit exclusions |
| --- | --- | --- |
| Employee workflow runtime | Source/context and current binding/lifecycle reads above; locked contract/history/media/candidate reads; scoped workflow/full/version/receipt/commit-check inserts | No source/session/staff/profile writes; no binding issuance, lifecycle management, approval issuance, arbitrary key or storage administration. |
| Binding command service | Same authoritative source checks; exact operator-capability/approval reads; one-time `consumed_request_id` consumption; append `binding_versions`, `binding_requests`, `commit_checks` | No issuance of its own capabilities, approval or lifecycle decision. Bind/reassign/revoke/restore stay distinct approved operations. This is not a new public route. |
| Candidate publication/media publication | Exact server-owned candidate or validated metadata inserts and initial access rows, plus scoped reads and commit checks | No candidate/browser JSON ingestion, tombstone reversal or original-byte database storage. Keep provider/Storage I/O outside DB locks. |
| Optional legacy append | Exact two RPCs and transitive invoker dependencies above, including scoped legacy version INSERT | No legacy asset registration, ingest-grant management or rewrite. Do not enable by default when only full workflow is needed. |
| Authority/lifecycle administration | Independently verified capability issuance/revocation and exact lifecycle decisions; separate audited approval issuance/revocation | Not available to ordinary employee runtime or a browser. Production schema, durable audit and issuer are missing. |
| Access revocation administration | Separately reviewed monotonic `media_access` / `model_candidate_access` changes | No metadata/history deletion or revival. Existing fixture triggers alone are not an operational revocation service. |
| Credential and attempt services | Exact per-employee/purpose locking and CAS; protected durable approval consumption and attempt reservation/settlement | No table-wide employee key enumeration, plaintext key return, owner/global fallback or automatic replay of uncertain attempts. No production tables/DDL for these injected repositories are supplied. |

Common infrastructure should permit only the selected database connection, necessary schema usage, exact function signatures and the fixed statements selected for enabled capabilities. No sequence grant is implied: the shown private inserts supply their identifiers explicitly; audit real defaults/functions before adding any. The current executor uses one injected connection and does **not** implement role switching or these separations. A role diagram by itself does not enforce them. Either separate trusted entry points/connections with the reviewed subsets or introduce reviewed narrow database capabilities before claiming separation.

### Blocking mismatch: FOR SHARE is not SELECT-only

`postgres-executor.mjs` uses `FOR SHARE` for sessions, staff, bookings, frontdesk, profiles, bindings, authorities, lifecycle and contract rows; approvals also use `FOR UPDATE`. `postgres-workflow-repositories.mjs` uses `FOR SHARE` on workflow/full history and receipts, legacy versions/assets, media and candidate tables. PostgreSQL 17 requires SELECT on referenced columns **and UPDATE privilege on at least one column of each row-locked table**. This applies even when the application never issues a business UPDATE. [PostgreSQL SELECT privileges](https://www.postgresql.org/docs/17/sql-select.html).

Consequences for review:

1. A “SELECT-only source role” cannot run this SQL unchanged. Granting blanket UPDATE to mutable session/staff/assignment/profile tables would violate the intended business boundary. Swapping `FOR SHARE` for another row-lock strength does not remove that privilege requirement.
2. Do not remove row locks to avoid the error: current revocation, reassignment and commit guarantees depend on them. Do not assume a false UPDATE policy will retain all locked-read behavior; test actual role/RLS interactions.
3. Decide a lock-preserving mechanism in a separately reviewed implementation: narrow authenticated server/database capabilities, or another explicitly proven protocol. If a restricted column-level locking privilege is proposed for an immutable table, demonstrate that actual UPDATE/DELETE is still impossible under its triggers/RLS and non-owner role; do not apply that conclusion to mutable business tables.
4. A narrowly scoped privileged function would be a new security boundary requiring its own identity checks, fixed search path, ownership, non-exposed placement, execution ACL and threat review. `SECURITY DEFINER` is not the default remedy. No such function or permission design is implemented here.

Similarly, invoker RPC INSERT permission is not inherently “RPC-only”: a principal with direct INSERT may bypass the JavaScript validators. The production design must prevent unauthorized direct append/approval consumption and prove its checks at the database boundary, or explicitly review a narrower trusted-server boundary. A unique constraint, hash or version marker alone is not authorization.

### RLS and exposure acceptance

- [ ] Private schemas are excluded from browser/Data API exposure; no `PUBLIC`, `anon` or browser `authenticated` table/function access is added for this feature. Existing source protections are preserved. A frontend publishable/anon key is not a design-table permission.
- [ ] Review explicit ACLs, inherited roles, default privileges, function EXECUTE access and actual exposed schemas. Grants determine object access; RLS separately determines row access. RLS is required on exposed tables and reviewed as defense in depth on private tables. [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [ ] Define database-verifiable identity/scope for these custom employee tokens. Current Node checks do not establish `auth.uid()` or trustworthy PostgreSQL session claims. Do not invent a JWT mapping, rely on user-editable metadata, or treat an arbitrary client-set/session-setting claim as authority.
- [ ] Prove both positive and negative operations with actual non-owner production-like roles, not the disposable fixture administrator. Cover wrong employee/store/profile/visit, revoked/expired session and binding, direct table writes, function calls, role switching, immutable history and tombstone revival.
- [ ] Independently inspect real staging DDL, constraints, default expressions, trigger enablement, function definitions, indexes, RLS policies and role memberships. No real project was inspected for this draft. The repository's partial source-table fixtures cannot substitute for that evidence.

## 4. Secure key-input proposal, still unimplemented

The server has prepared key read/save/revoke routes and an injected `keySettings` seam. The **production secure key-entry UI, production encrypted repository, approval issuer and dedicated secret-manager integration remain unimplemented/unconfigured**. Keep all key routes unavailable until each is accepted. Never collect a real key in chat, the public synthetic/loopback page, a test fixture, localStorage, browser persistent caches, logs, analytics, screenshots or committed configuration.

### Identity is a hard prerequisite

`key-settings.mjs` currently owns and locks records by **`username + store + purpose`**, and rechecks the same username/store. This is not an immutable employee ID. A UNIQUE username constraint only prevents concurrent duplicates; it does not prove that a departed employee's username will never be assigned to another person.

- [ ] Prove and document that usernames identify one immutable person and are never recycled, including rehire/restore and store transfers, before the current scheme could be enabled.
- [ ] If that cannot be proved, first design and approve immutable `employeeId` ownership and a lossless migration/revocation plan. Old ciphertext must not become the key of a new employee with a reused name, or silently follow a store reassignment. Do not implement this by guessing from display name or copying records between stores.
- [ ] Test deactivation, rename, rehire, username reuse, transfer and concurrent provider use against the actual identity source. A supplied key or owner permission does not resolve this technical blocker.

### Proposed reviewed flow

1. A dedicated authenticated HTTPS settings surface revalidates the existing employee session and the selected purpose. No customer page, URL, query string or ambient chat stores the key. Pin the same exact trusted origins as the handler; implement reviewed origin/CSRF defenses, no caching, no third-party analytics/session replay and strict body/redaction controls. Do not use synthetic actor headers as identity.
2. Before submission, show the employee, store, purpose, exact recipient/destination, approved model, expected revision, encrypted storage location/retention and persistent-access effect. Obtain the required exact action-time approval through a secure channel that does not expose the key in conversation or telemetry. Key transmission and persistence must both be within that approval's scope.
3. The trusted verifier atomically validates/consumes a short-lived, non-replayable receipt bound to employee/store, action, purpose, exact destination/model, revision and the exact key's digest. That digest is sensitive metadata and must not be displayed/logged. Browser `approved:true` or an unbound chat “yes” is not this verifier. A consumed approval followed by a failed save requires a new approval, not blind receipt replay.
4. The server-only sealer uses a separately provisioned dedicated 32-byte secret from the approved secret manager, AES-256-GCM with a fresh 96-bit IV and authenticated employee/store/destination/model/revision context. No owner/voucher secret reuse, environment default or fallback. Provisioning, rotation and recovery access need separate approval and review.
5. Under a real shared employee-slot lock, recheck current identity and CAS the independent `chat` or `speech` revision. Return only `configured,revision,destination,model`. Decrypt only inside the bounded internal `withProviderKey` callback; never return the key, key lease or digest to a page. Do not claim JavaScript strings can be securely erased.
6. Revocation requires its own exact action-time receipt and leaves a revision tombstone. Coordinate with running dispatches, account revocation and bounded timeouts. Application revocation neither cancels an already sent provider request nor revokes the vendor credential. Specify vendor cancellation, backups, retention, key rotation and employee offboarding separately.

The current module fixes chat to `https://api.deepseek.com/chat/completions` and optional speech to `https://api.deepseek.com/v1/tools/asr` with `model:null`. These are existing code destinations, **not an approved provider/model selection**. Model allowlists remain empty unless explicitly approved; chat and speech are separate slots. A stored key never authorizes customer transmission, image processing, a paid call or automatic retry. See [KEYS.md](./KEYS.md), [PROVIDER.md](./PROVIDER.md) and [DESIGN-CANDIDATES.md](./DESIGN-CANDIDATES.md).

## 5. Exact owner decision packet: fill before asking

Record each answer beside its final reviewed proposal, with scope and date. Do not ask for blanket approval of blanks. Technical reviewer acceptance and applicable action-time confirmation are recorded separately; neither can be inferred from a key, a successful test or approval of an earlier stage.

| Decision | Exact question to present after placeholders are resolved |
| --- | --- |
| Deployment target and audience | “Do you approve deploying artifact `[commit/build digest]` to `[named staging or production project/service/region]`, at `[exact HTTPS origin/API path]`, for `[named owner-only accounts/stores]`, with only `[explicit features]` enabled during `[trial period]`? The hosting commitment is `[provider, total/currency or approved cap, payment type, one-time/recurring terms]`.” No provider or total is selected by this draft. |
| Database change | “Do you approve applying the reviewed additive change `[artifact revision/digest]` only to `[exact database/environment]`, creating/changing `[exhaustive schemas/tables/functions/triggers/indexes]` with `[named role memberships/ACL/RLS capability matrix]`, and no source-business rewrite? The schema compatibility, lock-order, direct-write protection and rollback evidence is `[review reference]`.” Security-sensitive/persistent-access changes still require applicable action-time confirmation. |
| Binding and lifecycle policy | “Do you approve `[named operators]` establishing/reassigning/revoking/restoring `[exact stable customer/visit/stylist scope]` using `[independent approval issuer]`, and `[authoritative lifecycle policy revision]`, with `[historical access/transfer rules]`?” A numeric imported booking status or staff title alone is not this policy. Each binding command still needs its exact one-time approval. |
| Persistent service access | “Do you approve creating/configuring `[specific database/storage/broker/service credential]` for `[named service identity and exact destination]`, limited to `[capabilities]`, stored only in `[approved secret manager/region/access list]`, until `[expiry/rotation schedule]`? Misuse could expose `[specific protected data/access]`; revocation and recovery are `[plan]`.” Obtain per-action confirmation before generating or configuring it; no secret value is requested in chat. |
| Employee key storage | “Do you approve securely submitting and persistently storing this employee's `[chat or speech]` provider key for `[verified immutable employee/store identity]`, `[exact destination/model]`, revision `[n]`, in `[encrypted server repository and secret manager]`, under `[retention/rotation/offboarding policy]`? It enables later approved requests to that provider and could be misused if exposed.” The exact key is entered only in the accepted secure flow, never in this packet. |
| Private customer storage | “Do you approve storing `[specific original text/audio/photo fields, metadata and derivatives]` for `[exact authorized customer/visit scope]` in `[named private storage provider/project/bucket/region]`, accessible to `[specific service/employee recipients]`, for `[retention period and deletion/recovery policy]`, at `[total/currency or approved cap and payment terms]`? Customer consent evidence is `[reference]`.” No public/signed URL or training/shared-knowledge use is implied. |
| External processing and fees | “Do you approve sending `[exact selected text/audio/photo derivative content and purpose]` for `[customer/visit]` to `[named provider, exact endpoint, model and region/terms if applicable]`, using `[payer/account/payment type]`, for `[one bounded request or explicitly bounded trial]`, up to `[total and currency including applicable fees]`, under `[provider retention/training terms]`? Customer consent is `[reference]`; cancellation/refund restrictions are `[visible terms]`.” Fill actual pricing/monetary bounds first. Token caps are not spending caps. |
| Recording/customer consent | “Has `[customer or authorized representative]` agreed to `[explicit recording/photo capture, private storage, selected external processing]` for `[purpose and retention]`, with `[withdrawal method]`? May the App request `[microphone/camera permission]` for `[this operation]`?” Capture/store/process are separate choices; no ambient recording or automatic future consent. |
| Rollback and stopping | “Do you approve the bounded stop/forward-recovery plan `[reviewed revision]`: disable `[exact features/services]`, preserve immutable customer history and pending/uncertain receipts, reconcile `[in-flight jobs/saves/provider calls]`, and restore `[approved compatible service/image revision]` under the existing forward-only release process? `[Named operator]` owns stop decisions and `[named reviewer]` verifies recovery.” Destructive deletion, credential changes or new charges are not authorized by a generic rollback approval. |

If a recipient, model, identity, data class, target, permission, cost or legal commitment changes, stop and revise the affected approval. Do not invent a provider, model, price, budget or customer-consent record to fill the packet.

## 6. Technical release gates and evidence still missing

- [x] **Bounded synthetic default-client synthesis acceptance:** Stage12 passed all 12 homepage/HTTP/PG/browser assertions with the unchanged 30-second client timeout after strictly request-local pure structural reuse. First model synthesis was 14.323 s; later-history cases were 16.377–16.736 s. Interrupted readback, navigation, close and identity changes passed without automatic regeneration. Preserve earlier 42.636/37.146 s and 32.060 s failed runs in SYNTHESIS-PROFILING.md; no timeout or authorization relaxation.
- [ ] **Production latency/load acceptance:** the psql fixture is not the deployed driver, synthetic provider is not the real provider, and one local pass is not a throughput or memory guarantee. Verify bounded request lifetimes, queueing/concurrency, process memory and real approved infrastructure before release. A late HTTP 200 is not successful user delivery.
- [ ] **Actual hosted route and runtime:** reviewed HTTPS listener/proxy, exact origin/CORS behavior, real bounded pg driver/pool leases, TLS, request cancellation, deployment packaging and platform limits. GitHub Pages does not host `/api/design`; a Fetch handler or a test HTTPS-to-loopback mapping is not a deployment. Current Supabase/Deno compatibility is not established.
- [ ] **Database definition and least privilege:** approved additive DDL/RLS/role/lock-capability design, immutable constraints, exact invoker dependencies, trusted approval/lifecycle administration and non-owner acceptance described above. Fixture administrator passes do not satisfy this gate.
- [ ] **Existing writer coordination:** canonical source/session/staff/legacy request/visit lock ordering, multi-row behavior, revocation-first/append-first outcomes, deadline-at-COMMIT, bounded waits and deadlock recovery. Legacy append after workflow initialization currently produces `PG_LEGACY_SOURCE_CHANGED`; specify a reviewed explicit synchronization/import policy rather than rewrite/flatten history.
- [ ] **Historical PG incident:** preserve the original intermittent `RELATIONSHIP_UNAVAILABLE` as unexplained. Later passing PG27 runs are evidence of those runs only. Require an approved bounded investigation with differentiating diagnostics under representative driver/runtime conditions, a defensible cause/resolution or equivalent evidence closing the technical issue, and independent acceptance. An owner's willingness to proceed alone does not close it. No repeat-until-green run or relaxed check/timeout is part of this checklist.
- [ ] **Credential identity and secure entry:** stable non-recyclable employee identity or approved immutable-ID migration, complete secure UI/verifier/transactional key repository, secret management, retention and revocation. Current username/store matching and mocked encryption tests are insufficient.
- [ ] **Durable attempts and approvals:** real atomic pending/completed/uncertain/not-sent ledger, protected validated results, exact consent/cost receipt issuance, crash recovery and no expiration that converts an uncertain request into permission to resend. Key storage does not implement this ledger.
- [ ] **Private storage:** exact private bucket/service credentials, immutable upload/readback, tenant/owner/scope checks, no public/browser object enumeration, approved retention and orphan reconciliation. DB and Storage are not one distributed transaction. Only authorized same-request readback/reconciliation follows uncertain publication.
- [ ] **Image worker/broker:** accepted dedicated nonroot Linux broker, rootless daemon with required cgroup-v2/systemd enforcement, immutable reviewed image and authenticated bounded IPC; physical resource/no-network/no-host-access/cleanup tests and native image corpus. Current daemon/rootless mismatch and absent approved image remain blockers. No rootful/Mac/synthetic/flag-based fallback, web/Edge Docker socket, new download or weakened limit may bypass them. See [PRIVATE-IMAGE-WORKER.md](./PRIVATE-IMAGE-WORKER.md).
- [ ] **Independent production-like acceptance:** exact proposed role/pool/TLS/proxy/storage/key/approval/worker combination in a separately authorized staging environment with synthetic records first. Include adversarial cross-scope reads/writes, session changes, username reuse, receipt replay, deadlines, crash/uncertain COMMIT, archive readback and cleanup. No production/customer data may be copied into fixtures by implication.
- [ ] **Bounded real quality trial:** only after all preceding applicable gates and exact customer/data/cost approvals, verify actual provider/model behavior and quality. Model suggestions remain unconfirmed until the employee confirms them; pairwise visible photo comparison is not causal/technical proof or automatic multi-view synthesis. Shared customer mining remains disabled.
- [ ] **Release/recovery:** exact artifact review, compatible schema/service version, current main/version checks, existing business regressions, least-privilege acceptance and no-downtime/forward-only release plan. No new rollout to staff or production is implied by owner-only acceptance.

Stopping generation alone does not revoke already stored candidates; authoritative access tombstones control future acceptance. Disable the whole runtime for a complete entry shutdown. Retain immutable versions, source evidence, original authors, key revocation revisions and pending/uncertain attempt receipts. Reconcile unknown outcomes with fresh authorization and the original request identity, not a new paid call or duplicate save. Rollback is not deletion or permission to restore weaker security.

## 7. Review references and completion record

Local companions: [README-postgres-executor.md](./README-postgres-executor.md), [WORKFLOW-POSTGRES.md](./WORKFLOW-POSTGRES.md), [CANDIDATE-POSTGRES.md](./CANDIDATE-POSTGRES.md), [PRIVATE-MEDIA-COMPOSITION.md](./PRIVATE-MEDIA-COMPOSITION.md), [PREPARED-RUNTIME.md](./PREPARED-RUNTIME.md), and [activation review](../../docs/ai-design-activation-review.md). Existing historical stage counts are not rerun or recertified by this document.

Primary documentation checked on 2026-11-15: the PostgreSQL 17 SELECT/function-security pages and Supabase API-security/RLS pages linked above. The [Supabase changelog](https://supabase.com/changelog.md) was reviewed for applicable change notices. Future deployment tooling must verify its pinned version and target selection against the [CLI v3 change notice](https://supabase.com/changelog/supabase-cli-v3); hosted HTTP acceptance must check supported TLS against the [HTTP cipher deprecation notice](https://supabase.com/changelog/cbc-tls-ciphers-deprecated). No CLI, target connection, configuration or project query was run for this documentation review.

Completion fields remain empty: owner approval reference `[pending]`; technical reviewer `[pending]`; deployment target/artifact `[pending]`; DB/role/RLS proof `[pending]`; key/identity/ledger acceptance `[pending]`; worker/storage acceptance `[pending]`; bounded provider/customer/cost approval `[pending]`; historical PG issue closure `[pending]`; release and rollback acceptance `[pending]`. **Overall status: review draft; not ready for live activation.**

## Stage13 additional gate: transaction execution and expiry semantics

- [ ] **Hostile-SQL commit deadline:** actual non-owner tests exposed that `SET CONSTRAINTS ALL IMMEDIATE` can evaluate an expiry trigger early and allow a later expired COMMIT. Fixed adapter paths retain fresh checks and default deferred protections; this does not certify a caller that controls arbitrary SQL. Resolve the approved transaction-execution boundary and deadline linearization semantics before enabling production. Do not call the exposure a passed security test.
- [ ] **Complete identity consumers:** the new immutable-authority slice and synthetic policy repository do not migrate existing key ownership/AAD, candidate/media/full-history authorship or shared-store lookup semantics. No automatic label/phone matching or historical hash rewriting is allowed.
- [ ] **Real issuer and data attestation:** independently preseeded synthetic receipts and context manifests demonstrate a boundary, not production approval issuance or authoritative real-photo/source access. Safe key input, scoped secret leasing and real cost bounds are not configured.

See `STAGE13-IDENTITY-CAPABILITY.md`, `STAGE13-POLICY-PERSISTENCE.md`, and `STAGE13-ACCEPTANCE-MATRIX.md` for evidence and untested scope.

## Stage14 evidence does not clear activation gates

- [ ] Review a precise threat model and deadline linearization point. USERSET transaction/statement/idle settings and SECURITY DEFINER transaction control do not fix the early-trigger exposure. The new fixed read protocol withholds late results; it does not promise absolute expiry at durable commit or transmission.
- [ ] Implement and verify a separately isolated authenticated broker, direct-DB denial, trusted driver disposal, wire/parser/query memory bounds and target least permissions. The local read facade is not OS/network isolation and is not connected to the full workflow.
- [ ] Implement real immutable key repository and independently issued one-time approvals; atomically review approval/key-write outcomes. Secure entry and secret storage remain unconfigured. Legacy keys must not be automatically relabelled or decrypted through v2.
- [ ] Implement locked artifact-access attestations and independent issuance against real authorities. Test old media/candidate/full-history reads and every new write in actual PostgreSQL; current compatibility is read-only with mock repositories. Current reader access must never rewrite unresolved historical authorship or old hashes.

No new user key is needed for these remaining offline tasks. Before any activation, request approval for the exact deployment target, roles/permissions and storage/key architecture. Later request secure key entry separately, and specific customer-data/recipient/cost authorization before a real external call. Historical PG intermittency and qualified Linux worker acceptance remain unresolved.

## Stage15 narrowed progress, unchanged activation rule

- Real isolated PG artifact sidecar and independent issuer now pass 17 checks, including original populated histories, restricted new runtime roles and HTTP read-only composition. This clears the absence of a local PG sidecar implementation, not production roles or complete write migration. The old reader still uses its pre-existing privileged fixture executor and storage is synthetic.
- New key settings explicitly require transactional approval consumption with CAS, not a separate verifier fallback. A key-only HTTP composition exists; no public issuer, secure input UI or real secret has been configured. Consult the Stage15 key report for actual acceptance status.
- Read-proof issuance currently supports initial grant and monotonic revoke, not renewal after expiry/revocation. Append-only regrant/renewal policy and tests remain required.
- The cloud Linux probe found no installed Docker/Podman or visible cgroup mount that could satisfy the existing worker attestation. Do not install, change security settings or substitute an unqualified worker silently.
- Full workflow writing still needs transaction-bound immutable owner/operation manifests and fixed database capabilities for all reachable mutation/replay branches. Neither a current reader proof nor a matching historic label is that authority. Keep the new route graphs read-only/key-only, with all other routes rejected; the legacy runtime is not automatically mixed in.

No real key or customer data is needed for remaining offline implementation. Before deployment request approval for the exact target, roles and grants, private storage, broker/issuer isolation and secret custody. Before a real provider trial separately establish recipient/data consent, spending bounds and the user's secure key entry.

## Stage16 progress and remaining all-or-closed graphs

- Native text workflow now has a tested same-connection fixed-capability path, exact independent legacy manifest, operation-author sidecars and old/new native reader compatibility (isolated non-owner PG18). The old raw-SQL executor is not a fallback in this path. Photos/model acceptance/full publication/homepage identity routes still need their own complete dependency capabilities and tests before they can be admitted. Rejecting unsupported scopes is deliberate; do not hide their history or silently strip dependency fields.
- Append-only proof renewal/regrant now has isolated PG17 and explicit read-runtime composition. Enrollment permanently tombstones the old base and preserves its original snapshot; existing proof bytes are not falsely described as wholly unchanged. Runtime and issuer cannot self-authorize renewal. Human-facing confirmation issuer/authentication, independent process isolation and production role review are still absent.
- The new SQL canonical writer accepts a documented conservative number range and ASCII keys. Unsupported values fail rather than rewriting old hashes; production schema/locale/serialization acceptance and broader numeric requirements remain to be reviewed.
- The latest complete environment/configuration inventory exposed no additional running qualified Linux worker. Saved configurations are templates, not proof of a compatible running rootless/cgroup/image environment. No new environment, software or security setting was created to bypass this gap.

Approval is not currently required for further isolated implementation. Before live activation, identify the exact host, role/permission migration and broker/issuer/worker boundaries for review. Only after those are ready should the user supply a key through safe input, and separately authorize actual customer-data recipients and spending.

## Stage17 dependency writes do not enable model processing

- The separate dependency runtime composes same-connection fixed media metadata,
  candidate publication/consumption and full-archive writes with exact historical
  manifests and immutable operation authors. Original rows/hash/authors remain intact.
  Independent issuer state and live access/consumption checks are distinct.
- Provider generation routes remain closed: generic legacy key/attempt injection is
  not proof of immutable key ownership or durable disclosure/cost authority. Connect
  those complete paths before admitting generation; never use the old runtime as a
  fallback merely because an unported route exists.
- Media approval requires the immutable-aware verifier contract. Its trusted callback
  and synthetic receipt tests do not create a production approval issuer, private
  Storage setup or qualified decoder worker. No true distributed object/SQL commit is
  claimed; orphan reconciliation must inspect exact state after an uncertain outcome.
- Native-linked full history is supported. UI-only full history and cross-stylist
  originals failing existing owner checks remain conservatively closed. A manifest is
  historical read authorization, not old request ownership or permission inheritance.
- Arbitrary-SQL expiry-at-COMMIT exposure, unknown historical PG intermittency and all
  host/driver/isolation/real-secret/permission activation gates above remain unresolved.

Continue offline implementation without real secrets. Before deployment request the
specific target, persistent roles/permissions, issuer/broker boundaries, private
storage and secret-custody approval. Request safe key entry only once those are ready;
real customer-data destinations and spending need separate authorization.

The Stage17 acceptance calls the real HTTP handler and restricted-role PG adapter
with synthetic dependencies. It is not a new-mode browser/network/pool/load test.
The separately retained original browser regression still uses the original runtime;
its latency evidence must not be attributed to the new immutable dependency mode.
Homepage identity/list and live provider/ASR integration remain separate route gates.

## Stage18 personal-provider and homepage gate

- Additive test-only SQL binds the existing ledger to immutable personal keys and
  current workflow/manifest source, with independently issued exact approvals.
  Runtime has fixed capabilities only and cannot sign an approval or read raw keys.
- Homepage discovery requires explicit stable employee/store/customer/visit bindings;
  no name, phone, legacy key or old request is silently adopted. Key rotation,
  revocation or changed source also conservatively closes prior completed replay.
- Short key snapshots replace holding a key transaction over provider I/O. Preserve
  final atomic dispatch checks and uncertain-result tombstones. This does not solve
  arbitrary hostile SQL's physical-COMMIT expiry boundary or retract sent requests.
- Cost approval is not hard vendor billing enforcement. Production needs independently
  verified pricing/limits, secure key entry/custody, a trusted separate issuer and
  explicit data-recipient authorization. Browser mock approvals are not that issuer.
- New immutable image analysis/compare/synthesis remain disabled. Private media still
  needs qualified worker and durable immutable-aware approval service. Native-linked
  history only; unsupported older UI-only or cross-stylist private originals stay shut.
- Do not ask for an API key yet: identify and approve the actual host, minimal roles,
  isolation, worker, secret custody and data-processing/spending scope first. This
  offline stage grants none of those and performs no production deployment.

## Stage19 visual capabilities are not deployment approval

Stage19 adds explicitly gated immutable visual/compare/synthesis factories and an
additive synthetic-only schema. Original Stage18 configuration keeps those routes
closed. Separate processing and exact external/cost receipts, live media/ancestors,
private candidate-namespace collision checks, local keyless synthesis and same-name
isolation now have PG21 coverage. See `STAGE19-MINIMAL-DEPLOYMENT-PLAN.md` for the
minimum ordered host, narrow roles, independent issuer, safe secret entry, private
storage/qualified worker and owner-only rollout decisions. None has been authorized
or provisioned by passing these tests. Existing historical mapping, PG incident and
physical-COMMIT-expiry limitations remain.
