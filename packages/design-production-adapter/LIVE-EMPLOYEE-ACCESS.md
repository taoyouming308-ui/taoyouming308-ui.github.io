# Existing employee App session verification

The current `perm-app.html` uses the opaque `employee_booking_sessions` login,
not the separate operations Supabase Auth login. The new additive
`design_employee_verify_session` RPC is SECURITY INVOKER, callable only by the
existing service_role. It performs indexed SELECTs on the exact session hash
and UNIQUE staff login, returns that staff row's primary key and creation
instant, and verifies current active employment, exact store and expiry. It does
not renew/delete sessions, acquire row locks, change old grants/policies,
read customers/bookings, issue passwords or write business rows. A recreated
staff account cannot inherit a session created before that account.

`design-employee-authority` authenticates only the supplied employee's existing
opaque session. Its platform JWT check must be false **only because this is the
existing custom session format**; missing/invalid credentials are rejected
inside the handler. No anonymous identity response is available. The existing
service key remains inside Edge memory and never reaches the photo host or
browser. CORS allows the exact published App origin. No wildcard, credentials,
redirect, retry, renewal, logging or generic database path is added.

The server-only `createLiveEmployeeSessionVerifier` calls this one fixed TLS
endpoint. It verifies nonce, actual response URL, bounded private/no-store JSON,
credential binding, short database freshness and stable staff identity on every
call; there is no session cache. A later recheck rejects store/name/account
changes. Both clocks need normal synchronization; excessive drift denies access.

**Authentication is not customer permission.** This verifier cannot replace
the existing immutable subject/employment/store membership mapping, current
visit binding/lifecycle, independently granted upload/view receipts or final
transaction checks. No automatic name/phone mapping, grant bootstrap or SQL
fixture installation follows from a successful verification. Model routes stay
disabled. Before activation the real host must bind the verifier into the
production identity provisioning and current source/revocation checks; those
components require their own tests. Existing Edge functions remain untouched.
