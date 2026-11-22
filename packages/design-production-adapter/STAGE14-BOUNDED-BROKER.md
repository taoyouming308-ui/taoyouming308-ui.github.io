# Fixed-operation read broker: a narrower interface, not a database bypass cure

`createBoundedIdentityReadBroker` is a **default-closed, in-process server facade**. It accepts exactly `{operation:'read_scope_records',credential,scope}`. There is no SQL string, transaction callback, constraint-setting, timeout override or arbitrary operation in its caller interface. The private injected connection and complete SQL statements stay inside trusted server code. No HTTP route, network policy, standalone process, credential or production deployment is created by this module.

The facade composes the actual Stage13 identity capability reader on one restricted connection. It preserves source/session/membership/binding/lifecycle checks, explicit final authority recheck and ordinary deferred deadline checking. It does not substitute names for immutable identity or turn the synthetic scope-record table into production workflow/media/history access.

## Lifetime and pool ownership

A trusted configuration bounds a request to at most two seconds on a monotonic clock. Acquisition, query results, final validation and response delivery are checked against that budget. Fixed PostgreSQL transaction/statement/lock/idle settings provide additional ordinary-path limits. They are **not** immutable settings for someone possessing arbitrary SQL access, as the separate deadline experiment proves.

A timeout withholds all results, requests connection destruction while the request still owns the lease, and never retries. A late acquisition cannot start SQL. Failed or uncertain BEGIN/COMMIT paths discard rather than return a clean pooled lease. Before invoking release, the request relinquishes its right to destroy that connection; a late timer must not kill a lease already handed to another request. Queued interrupt callbacks recheck ownership. Release failure withholds the result and quarantines reuse of that client object in this broker instance.

The injected production driver's `release(error)` must actually discard uncertain leases, and `destroy()` must interrupt the owned operation. The facade cannot guarantee physical cleanup by a particular wall-clock instant if that trusted driver hangs. Its bound is a **result-withholding deadline**, not an OS kill guarantee. No detached process or remote connection is forcefully assumed cleaned without evidence.

Parsed results are strictly copied, scoped and bounded to at most 50 records and the policy JSON limit. This is **after driver parsing**. Wire bytes, parser memory and underlying database aggregation memory still need limits in a production driver/query boundary. The default read capability currently returns synthetic scope records, not a full migration of existing large workflow archives.

## Threat model

An untrusted caller limited to this facade cannot submit `SET CONSTRAINTS`, `SET transaction_timeout=0`, `COMMIT`, a SQL fragment or a transaction callback. A compromised broker process, modified trusted dependency or stolen database credential is a different threat: this in-process facade does not prevent those actors from using SQL outside it. A real separated broker deployment would require reviewed process/network/credential isolation and finite authenticated RPC exposure. None has been configured here.

Neither this facade nor a `SECURITY DEFINER` wrapper establishes absolute authorization validity at durable commit, acknowledgement or physical transmission time. The Stage13 hostile-SQL exposure remains documented. The new facade must not be described as silently changing the meaning of expiry or repairing that database guarantee.

## Local evidence

- Pure suite: 18 assertions cover zero-I/O disabled/invalid input, getter/Proxy rejection, fixed statements, scoped/frozen output, late acquisition, deadlines during query/release, driver error sanitization, foreign result denial, missing destroy support, unknown BEGIN/COMMIT, pool handoff ownership, clock failure, concurrent duplicate leases and oversized parsed rows.
- Actual restricted-login PostgreSQL: 6 assertions cover exact scoped reading, SQL/settings injection rejected before acquisition, cross-employee denial, deliberate query timeout/destruction, real lifecycle expiry rejection and absence of committed context residue. Exact labelled container cleanup was verified. All data were synthetic.
- The independent diagnostic found that all three ordinary timeout parameters were USERSET and bypassable by the runtime role, parameter ACL revocation did not remove that ability, and a security-definer procedure could not COMMIT. See `STAGE14-DEADLINE-BOUNDARY.md` for controls and the separately exposed limitation.
