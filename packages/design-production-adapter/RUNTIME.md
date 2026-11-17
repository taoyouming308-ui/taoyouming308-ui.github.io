# Runtime and outbound transport preparation

The existing `employee-bookings-api` deployment runs in Supabase Deno Edge Functions and uses the existing custom employee session plus REST/RPC. The prepared code in this directory is currently exercised locally in Node. This document does not authorize a new service, database connection, credential, permission or deployment.

## Explicit official transport

`createPreparedOfficialTransport({enabled:false,fetchImplementation})` returns the callback used by the provider/ASR modules. There is no implicit global fetch, default network connection, environment key, retry or model choice. Enabling it requires an explicitly supplied trusted Fetch implementation; application transmission/cost gates and employee-key callbacks still run in the caller and cannot be bypassed by this transport.

The request contract is exactly the existing provider runner's shape. Only its two official HTTPS destinations are accepted; POST, `redirect:error`, `credentials:omit`, no referrer and no-store are fixed. Chat accepts the bounded JSON body; ASR accepts exactly one fixed-name WAV form file. MIME/WAV contents are validated by the speech module before transport. The transport itself does not interpret customer data, add identity fields, approve processing or select a model.

Response URL/redirect/status/content type are checked, actual streamed bytes are bounded independently of Content-Length, and errors never return raw dependency messages. There is no automatic retry. The provider runner owns the bounded timeout and marks dispatch failures uncertain in its ledger. This adapter cannot undo a billable request after dispatch. A Fetch implementation must honor the captured AbortSignal and enforce ordinary TLS verification; no security warning or redirect bypass is supplied.

Tests supply synthetic `Response` objects and never call an external service. Passing transport tests is not account/model/API compatibility, consent, cost or live-response verification.

## Runtime validation boundary

Server modules that use `Buffer` now explicitly import `node:buffer`; the runtime test removes Node's global Buffer before importing and validating representative paths. This removes one implicit runtime dependency, not all differences between Node and Deno.

No Deno executable was found on the current selected computer. Existing Edge function deployment/type-checking, actual Postgres driver compatibility and connection limits remain unverified here. Native process-based image decoding is not available inside an ordinary Edge isolate; it needs a separately reviewed controlled worker or an approved compatible decoder service. Do not claim the native decoder can simply be imported into the existing Edge function.

A future deployment must identify the exact runtime, approved database interface and transaction/connection lifecycle, private decoder/storage worker and resource isolation, then run exact-runtime integration and permission tests before enabling owner-only real data. Do not replace a missing atomic SQL boundary with independent REST calls or a missing decoder sandbox with relaxed process limits.
