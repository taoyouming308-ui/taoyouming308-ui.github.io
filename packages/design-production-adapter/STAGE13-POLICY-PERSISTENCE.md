# Isolated durable policy repository and authority boundary

Work in progress. No production migration, role, issuer, secret, credential or provider access is enabled by these files.

`postgres-provider-policy-repository.mjs` is default closed and uses an injected restricted connection. It executes only fixed parameterized functions, on the same transaction/connection as immutable authority resolution, context guards and final identity recheck. It checks the actual COMMIT tag; an unknown COMMIT outcome is not a retry instruction. The accompanying SQL lives under `drafts/`, refuses an ordinary database, and installs only into the explicitly labelled synthetic fixture. It is not a production migration.

## Independent authority, not a Boolean in the browser

The fixture administrator seeds two independent proof sources before the runtime request:

- An exact `issued_receipts` row containing the approved immutable authority, disclosure, budget, expiry and receipt ID. Runtime cannot create or update this table. A mocked issuer returning `true` or a fabricated receipt is insufficient to persist approval.
- An exact `context_permissions` manifest containing immutable authority, intent, canonical owner key and legacy key/fingerprint mapping. Runtime cannot create or update it. This represents the **interface** required from a real authoritative source/media verifier. It does not implement the existing production candidate/media/ancestor mapping, a secure issuer or a production attestation service.

The trusted fixture seed derives the owner key from subject/employment/membership/store/request, using the same strict policy contract. Database insertion and dispatch must match that protected key mapping, not only a caller-chosen hex key. This prevents a runtime caller from occupying another principal's global attempt key through the local branch. Source/derivative reference hashes and exact recipient/model/budget remain part of the approved intent.

## Restricted SQL and immutable states

Actual acceptance connects as a non-owner LOGIN, not postgres followed by SET ROLE. Runtime has only exact private function execution. Functions execute as a separate non-login, non-owner, non-BYPASSRLS capability role; runtime has no membership in that role. All policy tables enable and force RLS. Identity/source/context tables are inaccessible to runtime. The capability role's lock-only UPDATE column grants are guarded by a real immutable trigger for independent receipt/context rows; they are not described as absent privileges.

Approval association requires the independently issued exact row. Only consumption by its own immutable request or monotonic self-revocation is permitted. There is no reactivation. Independent issuer revocation is additionally checked during every read. Receipt IDs are unique. In this prepared policy, an expired approval also withholds completed provider-result replay; this does not delete immutable archive history. Renewal/re-consent for that completed readback is not implemented and must not silently create a new paid request. A deferred constraint trigger checks approval expiry at COMMIT on the fixed adapter path. **It is not a hostile-SQL commit guarantee:** a role allowed arbitrary SQL can issue `SET CONSTRAINTS ALL IMMEDIATE`, cause early evaluation, then wait past expiry before COMMIT. The isolated negative control must expose this separately; production release remains blocked on the chosen transaction-execution boundary and deadline semantics. No trigger workaround or added privilege is claimed.

Attempts start pending and never reset. Paid completion requires dispatch_claimed; local deterministic completion needs no paid approval. Unknown or not-sent terminal outcomes remain tombstones, as do pending/claimed records after a crash. Only exact revision CAS can advance an allowed state, and immutable fields cannot change. All result data is bounded; real model response validation remains the existing server runner's responsibility.

## Linearization and physical transmission

Dispatch-claim COMMIT is the authorization linearization point. Its transaction locks current identity, exact source/context and approval state, consumes the one-use receipt and marks the attempt claimed. Revocation that obtains its write lock first blocks the claim. Revocation committed **after** a successful claim cannot promise to retract that claim or undo an eventual provider call. Connection release and transport scheduling are not atomic with PostgreSQL. No assertion claims physical transmission and database commit are one transaction.

The runner may start one transport only after a successfully acknowledged claim. A lost claim COMMIT acknowledgement suppresses transport and leaves a durable uncertain/claimed record. This conservative result can consume approval without any charge; it must be reconciled, not automatically retried under a new ID. After a provider response, current authorization and approval/context checks still govern delivery. A committed result may remain stored even when delivery is withheld.

## Scope not yet covered

Legacy username/store key ownership, full candidate/media/authorship identity migration, all existing executor operations under non-owner privileges, production source attestation and approval issuance, real secret-manager input/lease, hosted driver/TLS/connection pool, worker isolation and load/memory limits remain separate gates. Synthetic costs are test values, not a quote or approval for a paid service. The actual historical PG incident remains unresolved unless its own causal evidence is recovered.

Tests and final measured results must be recorded only after they run; this design does not itself certify them.

## Final local verification

Actual non-owner PostgreSQL policy suite: **18 ordinary/denial assertions passed**, plus the **separately confirmed hostile-SQL expiry exposure**. The latter is an unresolved blocker, not protection success. Tests cover independent receipt enforcement, cross-employee result/approval denial, original runner dispatch/completion, fresh-instance completed replay without key/provider, concurrent reservation, lost dispatch COMMIT acknowledgement, issuer/context withdrawal, monotonic self-revocation, illegal state transitions, malformed/extra/null-state records and wrong global local key. Default deferred expiry rejects late COMMIT; explicit immediate constraints expose the documented limitation. Exact labelled fixture cleanup was verified. All issuers, data-context manifests, keys and provider responses were synthetic.
