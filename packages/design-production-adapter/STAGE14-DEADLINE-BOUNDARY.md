# Stage14 deadline boundary: measured limits, not a fix

2026-11-15, baseline `f0dfb1fe`. This is isolated synthetic research. No production SQL, permission, credential, timeout, provider call or runtime authorization path was changed. The original Stage7 intermittent `RELATIONSHIP_UNAVAILABLE` incident was not rerun and remains unexplained.

## Two different adversaries

**Untrusted caller of a fixed service interface.** The caller controls request data, not SQL, transaction commands, driver objects or server configuration. Existing fresh identity/source/approval checks, locking, CAS, receipts and deferred deadlines must remain. A finite trusted operation interface can prevent this caller from choosing `SET CONSTRAINTS`, resetting timeout values, pausing a transaction through arbitrary callbacks, or committing a partially checked operation.

**An attacker controlling arbitrary SQL under the runtime database LOGIN.** The role may still have no direct business-table DML, no owner membership and no BYPASSRLS. Nevertheless, it controls ordinary transaction commands and user-settable settings. Stage13 showed that it can force constraint triggers early and then commit after their checked deadline. A safer HTTP/IPC shape does not repair this adversary's database boundary. Compromising the trusted broker or obtaining its database connection/credentials enters this second model.

Neither model includes a database administrator changing definitions or a malicious database/host. Such administrators are a separate trust boundary, not a capability that RLS can constrain here.

## One bounded PostgreSQL 17 experiment

Command: `node scripts/diagnose-design-deadline-boundary.mjs`.

It reused the existing isolated identity fixture with a real restricted LOGIN, not `postgres` followed by SET ROLE. The already installed image was run with `--pull never`, `--network none`, no ports or host mounts and tmpfs data. Fixture-only installer changes were confined to that newly created container. Each deliberate wait was 0.5 or 1.5 seconds; no business timeout was increased. Logs contain fixed phases, allowlisted SQLSTATEs and elapsed milliseconds, never raw messages, SQL, tokens or row content.

Actual result: **13 expected controls and 1 separately exposed gap**, exit 0, exact labelled container absence verified. This is evidence that the experiment behaved as expected, **not 14 security protections passing**.

| Control | Observed result | Meaning |
| --- | --- | --- |
| Runtime role and `pg_settings.context` | Restricted actual LOGIN; all three timeout settings have context `user` | Test used the claimed non-owner role. These settings are user-settable in this PG17 fixture. |
| `transaction_timeout=250ms` and a longer active statement | `25P04`; context insert rolled back | Positive transaction-lifetime control works while enabled. |
| `statement_timeout=250ms` and a longer statement | `57014`; context insert rolled back | Positive statement-duration control works while enabled. |
| `idle_in_transaction_session_timeout=250ms` and a longer client-side idle gap | `25P03`; context insert rolled back | Positive idle control works while enabled. |
| Each setting changed to zero before the wait | All three completed | Runtime SQL can disable each control. |
| Each setting reset before the wait | All three completed | RESET restores startup defaults, not a mandatory per-operation bound. The fixture's statement default was longer than the short control wait. |
| Fixture administrator revokes parameter SET ACL from PUBLIC and runtime, then runtime sets all three to zero | All three settings became zero | Parameter ACL revocation did not remove the intrinsic ability to set these `user` settings. |
| Default deferred context trigger, clear context, wait past original expiry, COMMIT | `42501`, no context committed | Existing fixed-path deferred check still rejects expiry during commit processing. |
| Same operation, but first `SET CONSTRAINTS ALL IMMEDIATE` | COMMIT succeeded after expiry | **EXPOSED:** the trigger was consumed early. This remains an unresolved adversarial-SQL boundary. |
| Restricted caller invokes a fixed `SECURITY DEFINER` procedure containing COMMIT | `2D000` | A definer procedure cannot simply own the privileged work and commit it before returning. |

Every failure-control transaction was checked for rollback. The experiment did not enable prepared transactions, install extensions, touch host configuration or rerun the historical legacy suite. The successful baseline of this experiment does not explain that old incident.

## Why the proposed shortcuts are insufficient

- Resetting constraints to deferred once does not prevent the same SQL caller from making them immediate later. A non-deferrable trigger checks a statement, not the eventual commit.
- Replacing expiry enforcement with a timeout changes the assertion. Statement and idle limits cover different intervals; transaction timeout is useful for resource bounds but the tested role can disable it. PostgreSQL also excludes prepared transactions from this timeout. No claim is made that timer delivery proves a hard wall-clock durability deadline. [PG17 client defaults](https://www.postgresql.org/docs/17/runtime-config-client.html)
- A `SECURITY DEFINER` procedure cannot COMMIT. A procedure with a configuration `SET` clause also cannot use transaction control. Changing it to invoker security does not hide the underlying privileges from that invoker. The current experiment proves the definer restriction; it does not certify an invoker-procedure redesign. [PG17 CREATE PROCEDURE](https://www.postgresql.org/docs/17/sql-createprocedure.html)
- PostgreSQL explicitly permits changing deferrable checks during the transaction, including retroactively firing pending constraint triggers. There is no demonstrated ordinary role grant here that turns this command into an unalterable commit-only mechanism. [PG17 SET CONSTRAINTS](https://www.postgresql.org/docs/17/sql-set-constraints.html)
- The precise guarantee of the existing deferred check is a check during commit processing on the unchanged fixed path. It is not proof that the durability record, acknowledgement, network delivery or physical provider transmission happens before the same wall-clock instant. Do not silently replace an agreed deadline with authorization at an earlier call point.

## Finite trusted broker: useful containment, separate acceptance

A broker without an SQL channel is the smallest credible containment direction for **untrusted service callers**, not a database-only fix for **arbitrary runtime SQL**. Its useful claim is: callers cannot select commands, keep a transaction handle, alter constraint timing or inject callbacks between the final guard and COMMIT through its supported protocol.

Required boundary before such a claim can be made:

1. The caller-facing API accepts only versioned, bounded named operations and data. No raw SQL, function name, driver/pool object, transaction handle, executable callback, timeout setting or constraint mode crosses that boundary. Strings are bound values, never executable fragments.
2. Only the separately trusted broker obtains the restricted DB lease. Application clients cannot bypass it via database network access, copied credentials, inherited file descriptors or alternate administrative endpoints. A JavaScript wrapper in a process that still gives the caller `acquireClient` is not that isolation proof.
3. Each operation retains the existing same-connection identity/source/approval locks, full immutable owner tuple, exact request/receipt CAS, final fresh guards, deadline checks and immutable histories. No external model/storage call or caller-provided asynchronous callback runs under the transaction locks. Resource limits are defense in depth, not authorization.
4. Cancellation, driver failure or lost COMMIT acknowledgement never grants dispatch or an automatic retry. Discard uncertain leases and reconcile the immutable request state. Acknowledgement loss is not evidence that the transaction failed.
5. Test authenticated IPC/HTTP framing, unknown/extra operation fields, payload limits, concurrent identities, replay/conflicts, failed connections, cancellation and direct-DB denial under the proposed host identities. An in-process mock only tests the protocol and scheduling logic; it cannot prove OS/network or credential isolation.

The broker itself, its trusted configuration, database connection and host remain trusted. If any is compromised, the arbitrary-SQL exposure still applies. The new identity/key compatibility modules do not remove that exposure. A production switch must remain closed until the chosen trust boundary and deadline meaning are explicitly reviewed and accepted, not merely until a normal-path test passes.

For paid operations, durable dispatch-claim commitment, physical transmission and result delivery remain separate events. A later revocation cannot retract bytes already sent. Fresh result-delivery checks and uncertain tombstones remain necessary; neither the broker nor PostgreSQL provides external exactly-once execution.

## Unchanged blockers and next decision

No runtime mitigation was installed by this stage. The adversarial-SQL commit-expiry gap, actual host/broker isolation, target database permissions and exposure, immutable-identity migration of existing consumers, secure key provisioning, worker isolation and the unexplained legacy incident remain open. The next decision is which precisely stated caller/host trust boundary and deadline semantics are acceptable. It is not permission to weaken the existing check or activate production.
