# Local classification-only review

Base: d330bc9df99e552b117a0695100bc7473224d06c (latest fetched github/main).
Branch: review/mgj-exact-catalog-v10-local. Published v600 remains unchanged.

Scope: eight user-confirmed exact source-store/code/full-name catalog additions; frozen
v9 generator; deterministic v10 SQL and offline/native synthetic tests. Migration changes
only catalog definitions, the existing audit version check (v1 through v10), and writer
version plus explicit-upgrade/legacy-template guards. Existing helper definitions and
ACL policies remain untouched. Existing revoke/grant statements for redefined functions
preserve baseline privileges; no new role, permission or setting is introduced.

No runtime Python, closed-day/busy-day/time-window changes, UI/Edge deployment, scheduler
change, production data mutation or historical recalculation. The original dirty development
checkout is untouched. Publication and the reviewed v10 migration are approved for this scope; verification precedes production changes.

The migration contains no install-time DML or writer invocation. Old drafts remain as-is;
source triggers cannot silently upgrade old mapping. Explicit upgrade preserves manual
values/blanks, confirmed/locked/multiple/legacy drafts, source guards, idempotence, immutable
audit and formal income. Exact catalog does not change role/payment/platform formulas.

## Verification

This split: 93 offline assertions pass; frozen v2–v9 generators byte-check; native PostgreSQL17
58 safety groups recorded separately after final synthetic-fixture review. All monetary
fixtures are synthetic, without sampled live reports, staff/customer identities or credentials.
Company/store scope constants and exact approved catalog facts are existing public source
configuration; they are not report records. Test data includes synthetic employee names and
placeholder private-field markers removed by existing normalization.

Final classification-only tree: full finance91 commands and remaining pre-push/browser gates
passed again. Earlier same-baseline candidate also passed
legacy PostgreSQL17 migration, Deno2.9.6 workflow type checks, SupabaseCLI2.109.1 release-help
contract, Python3.12.12/cryptography48.0.0 133tests passed. Local evidence does not claim a remote CI result for this branch.
Remote Ubuntu GitHub CI must validate the exact reviewed commit for the reviewed commit.
No remote check is currently triggered; no release version bump done.

## Safety and recovery

Review only the eight changed/new files listed in the local manifest. Diff contains no
production snapshots, real report financial examples, customer details, secrets, session
material or downloaded Library package. SQL version/name and migration drift must be checked
before release.

Before release: local candidate can be discarded without affecting runtime or production.
After migration: forward migration restores reviewed v9 catalog/writer
definitions, keeps v10 audit records and the v1–v10 version constraint, and preserves all human,
confirmed and formal income rows. Do not delete audit or attempt row rollback. Historical
recompute is limited to affected unconfirmed machine drafts and requires atomic
source/revision/manual/lock rechecks, beginning with a controlled sample. No formal posting.

Publication scope: the eight listed source/test/review files only. Exclude runtime, UI,
scheduler and unrelated worktree changes. Preserve all existing ACLs and financial protections.
