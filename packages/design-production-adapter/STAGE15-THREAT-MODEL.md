# Stage15: testable safety invariants and fixed-capability write boundary

Design proposal, not deployed functionality. No authorization checks are removed
or weakened. Stage13/14 evidence remains scoped to its actual synthetic slices.

## Claims we can test, and claims we must not make

- Identity is a server-established immutable subject/employment/membership/store
  tuple, with epoch and membership revision. Names are display, never proof.
  Rehire, transfer, deactivation and recovery cannot inherit prior permissions.
- Customer access also requires current visit assignment/binding revision.
  Historical authorship attestations do not grant current access; a current grant
  does not rewrite old author bytes or manufacture an attestation.
- A write is authorized at explicitly identified checks under the required locks.
  If a conflicting revocation wins the lock ordering first, the write must reject.
  If the authorized write wins first, a later revocation does not retroactively
  undo that committed history. All administrative mutations must participate in
  that same lock protocol; a mock resolver returning true cannot establish it.
- Check expiry at the existing required gates using trusted finite time. Existing
  deadline checks stay. Do not claim authorization necessarily remains valid at
  durable commit, response arrival or physical packet transmission. Scheduling,
  I/O and lock waits separate those events from the last check.
- A timeout withholds results, interrupts/discards the owned connection where the
  driver supports it, and reports uncertainty if a write may have happened. It
  is not evidence that rollback or process cleanup completed by a wall-clock time.
- A durable dispatch claim is unique for the full immutable owner/request/intent.
  Unknown claim acknowledgement, crash or transport outcome never authorizes a
  second send. This trades availability for safety; it is not exactly-once billing.
- The final dispatch authorization is followed immediately by transport invocation
  without another await. Already sent bytes cannot be recalled. Revocation after
  that checkpoint can block delivery of results, not undo provider processing.
- Completed replay requires fresh identity/source/ancestor/media checks and never
  retrieves a key or pays again. A retained result is not a retained access grant.

## Threat boundaries

An untrusted browser can choose only the finite documented request schema. It
cannot submit SQL, role/settings/transaction commands, callback code, identities,
model endpoints, key material for provider selection, or an authorization boolean.
The web process must not possess the broker's SQL credentials or Docker socket.
An in-process facade alone cannot enforce that separation against process compromise.
The independently provisioned approval issuer must not be available to the ordinary
runtime as a receipt self-signing capability.

A compromised broker/driver/issuer or a stolen broker database credential remains
outside the finite-caller guarantee. The demonstrated arbitrary-SQL ability to
alter constraint timing is not fixed by renaming a facade or using an expiry flag.
Do not remove that limitation from Stage14 documentation.

## Proposed complete write composition

1. A separately reviewed, authenticated broker accepts only versioned finite
   operations: workflow intent, media metadata publication, candidate publication
   and acceptance, archive publication, key slot mutation, and request-ledger
   transition. Each operation has a strict bounded schema and server-built context.
   No generic SQL or transaction callback crosses this boundary.
2. The broker alone leases the restricted database connection. Each fixed operation
   resolves current session/membership and scope on that same connection, locks
   authority/binding/target/receipt rows in a documented consistent order, reads
   the authoritative base revision, and validates the operation's exact evidence.
3. Preserve all existing workflow journal replay, hash, receipt, candidate source,
   ancestor-active, original media hash/stage/angle, attestation and CAS checks.
   Historical accepted exceptions remain exact, not a caller-selected mode.
   A pure immutable-validation memo never replaces fresh rows or access checks.
4. Write artifact and request receipt/consumption atomically in the same database
   transaction. Register and await the final guards, execute them, then fixed
   COMMIT. No external storage/provider/issuer network call occurs while holding
   database locks. Unknown acknowledgement is reconciled by the same request ID,
   not retried as a new write or provider request.
5. Immutable object staging is separate from metadata publication. A failed publish
   may leave an orphan; no reference becomes readable without committed metadata
   and fresh authorization. Cleanup must not delete an object whose publication
   outcome is uncertain. Storage plus DB is not represented as one transaction.
6. Provider preparation resolves exact content, official recipient/model, purpose,
   limits and approved cost. Durable reserve/claim transitions use the fixed ledger
   operation; the trusted dispatch boundary enforces one send and the final gate.
   Key lease validates immutable membership independently; key possession grants
   neither customer access nor fee authorization.
7. Read/return boundaries recheck current access. Post-COMMIT failure withholds
   sensitive results and reports committed/uncertain semantics as appropriate,
   rather than falsely claiming nothing happened. Exact already-committed replay
   semantics remain distinct from starting a new action.

This is a wiring plan, not an implemented broad broker API. Production needs the
real operation-specific repositories, independent issuer/attestation provisioning,
authenticated RPC and process/network credential isolation, bounded driver wire
parsing, validated connection destruction, audited deployment and rollback.
The v2 key consume dependency is not atomically coupled to its mock key transaction:
an approval can be consumed without a key write. Do not silently retry it.

## Minimum acceptance matrix for later implementation

For each fixed write: concurrent revocation/assignment change on both sides of the
lock ordering; expiry before every existing gate; lost BEGIN/COMMIT response;
post-COMMIT denial; duplicate request and mismatched payload; corrupt row/hash/
receipt; cross-membership same name; client SQL/settings injection; deadline and
late driver result; duplicate lease and pool handoff; bounded oversized input.
For dispatch: lost claim response yields zero new transport calls, completed replay
uses no key, cancellation after send does not fabricate not_sent, and exact payload,
recipient and cost receipt cannot be exchanged. Do not loosen timeouts to pass.

## Read-only cloud capability inventory (2026-11-15)

The Dot cloud environment was attached separately from the Mac checkout. Observed:
Linux 6.18.57 x86_64; uid 1000; CapEff zero; NoNewPrivs 1; Seccomp mode 2;
ImageMagick 7.1.1-43 Q16; Python 3.12.14; Node 24.22.1; unshare and bwrap binaries.
Python reports RLIMIT_AS (-1,-1) for the current process. No limit-changing or
namespace-creation probe was run.

No docker, podman, nerdctl or ctr executable was found by command lookup; no Docker
or Podman socket was observed at the checked conventional locations. `/sys/fs/cgroup`
was absent; `/proc/self/cgroup` contained `0::/`. Consequently this observation
cannot establish a controllable rootless daemon, cgroup-v2 resource delegation,
worker-global memory/pid quotas, any approved installed container image or the
existing Docker driver's required inspect evidence. Binary presence and seccomp
mode do not prove network/filesystem isolation or native decoder safety.

The installed ImageMagick policy listed resource limits and URL/HTTP/HTTPS coder
restrictions, but was not the application's reviewed deny-by-default worker policy.
No image was decoded, workload started, image pulled, software installed, system
setting changed, credential provisioned or customer material transferred. This is
potential infrastructure for a later explicitly authorized synthetic Linux test,
not production worker attestation. The minimum gap is an approved, controllable
isolated worker boundary with verified hard limits and negative tests, plus a
reviewed pinned decoder runtime. Current production paths must remain fail-closed.

## Existing executor is not yet this write boundary

The current `postgres-executor.mjs` retains legacy actor `{username,store}` checks,
direct business-table statements and callback transactions. The separate Stage13
role exposes only its limited capability slice. Wrapping the existing runtime in
fresh checks before/after its independent transactions does not atomically bind
those legacy writes to immutable identity, and is not complete safe write wiring.

A possible incremental seam is an **internal same-connection authoritative gate**
created only by the executor: establish immutable transaction context before any
business read/write, bind the fixed operation and expected revision, resolve and
lock current authority/binding there, and recheck it after existing hooks before
COMMIT. Do not expose a caller hook that merely returns true. This seam helps
composition but is insufficient without database enforcement of the same context.

Required operation-specific capabilities include workflow base/history/receipt
reads and CAS+receipt writes; candidate publish/read/consume plus ancestor checks;
media record/access checks and immutable publication; full archive insert/read;
key owner slot CAS and approved receipt consumption. They need non-owner runtime
permissions, scoped context validation, and independently established artifact
access/legacy authorship attestations. Legacy hash/author/journal bytes stay intact;
missing proof cannot be inferred from a same-name actor or silently auto-issued.
All history replay and freshness checks remain inside the corresponding operation.

Enablement must be all-or-closed for each complete route graph. If an immutable
operation calls an unmigrated legacy repository or falls back to a directly granted
old write role, reject rather than mix new reads with old writes. An implementation
must enumerate and test every reachable read, mutation, archive and replay branch,
not just the first gate. No executor hook, SQL capability or route change has been
implemented by this threat-model document.
