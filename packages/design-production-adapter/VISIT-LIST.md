# Authorized day list and stable visit selection

This server preparation reuses the existing opaque employee-session verifier, appointment/frontdesk source tables, shared customer-context resolver and explicit append-only visit binding. It does not install a production handler, database migration, permission, credential or synchronization job.

## Exact server interface

`repositories.listAuthorizedVisits({credential,date})` returns:

```js
{
  date: 'YYYY-MM-DD',
  visits: [{
    id: 'booking:123',
    displayName: 'A name read from the bound profile',
    visit: {assignmentSource:'appointment',visitId:'booking:123'},
    bindingRevision: 'binding:1'
  }]
}
```

The request contains no username, store, profile ID, name, phone, scope grant or pagination credential. The server derives employee/store from the real session and active staff row. `date` must be an explicit valid Gregorian date. The service does not guess the salon's business day from UTC or local machine time. Frontdesk visits retain their UUID locator and are never folded into appointments by matching a name or phone.

Each pass scans only that employee/store/date's appointment and frontdesk locators using fixed parameterized SQL. The combined **scanned-source limit is 50**. An overflow raises the fixed `VisitListError('VISIT_LIST_LIMIT_EXCEEDED')`; no truncated page is presented as a complete customer list. This is a bounded day view, not a list of all stored customers. There is no pagination in this stage.

Before releasing any row, the service verifies the exact current source, stable profile binding, lifecycle decision, employee/store and shared customer context. Only afterward does it read the bound profile's minimal display name (at most 160 characters). Longer names, surrounding whitespace and control characters are rejected, not truncated or silently renamed. Names and phones are never join keys or authority. Two separately authorized stable bindings remain separate even when the customers share the same name and phone. Phone numbers and profile/scope objects are not returned.

Missing or ambiguous stable bindings produce no customer details or locator in the result. Other invalid, inconsistent or unavailable dependencies fail the operation rather than quietly becoming an empty list. Two independent read transactions must agree on the scanned locator set and authorized internal results before the public projection is returned. No archive, candidate, booking, frontdesk, profile, receipt or deadline row is written by listing.

## Selection is reauthorized, not trusted

The browser retains the selected row's locator and `bindingRevision` and sends:

```js
resolveVisitScope({credential,visit,expectedBindingRevision})
```

Both independent resolver reads must match that expected binding revision while freshly checking all authority. A changed revision is not silently replaced or retried; the user must explicitly refresh the list. The returned scope is then used for the existing independently authorized workflow load.

For the current binding contract, the visit locator plus append-only binding revision pins the original stable profile: profile, store and date cannot be reassigned within that binding history, and immutable binding records are bound to their request receipts. The revision is not a credential, signature or permission grant. A future approved cross-profile correction/reset workflow must revisit this guarantee rather than reusing an old revision number.

Existing old-entry `resolveVisitScope({credential,visit})` remains compatible, but does not claim that it refers to a previously displayed list row. It still performs its existing two independent authorization reads.

## Failure and deployment boundary

`VisitListError` is exported from `visit-list-service.mjs`. Only fixed known codes are exposed: `VISIT_LIST_INVALID_REQUEST`, `VISIT_LIST_INVALID_DATE`, `VISIT_LIST_NOT_CONFIGURED`, `VISIT_LIST_ACCESS_DENIED`, `VISIT_LIST_UNAVAILABLE`, `VISIT_LIST_CHANGED` and `VISIT_LIST_LIMIT_EXCEEDED`. Actual error classes and allowlisted codes are used; arbitrary dependency messages or similarly named errors are not trusted.

The results are snapshots at their final database checks, not durable access grants. Selection and every subsequent operation reauthorize. Existing external writers still need a production lock-order audit, and the bounded repeated authorization checks need production capacity/runtime acceptance. Synthetic PostgreSQL tests do not certify Supabase Edge/Deno compatibility, production RLS/roles or real lifecycle policy correctness.

The earlier intermittent legacy-PG authorization failure remains unexplained. Existing failure tracing is retained. No new causal evidence justified repeating the same diagnostic experiments in this stage, and passing unrelated list tests does not remove that launch blocker.

### Shared browsing is not this service-list authority

The general customer browser's `scopeCustomerProfile` can expose a home-store-other profile when it has records from the current store. That does not currently authorize this prepared service workflow: `employee-adapter.mjs`, `visit-binding.mjs` and the existing `resolve_customer_design_context` RPC already require the profile home store to match the service store. The display-name same-store check repeats that verified constraint; it does not introduce a new narrowing of the prepared gate. This is an assigned, stably bound visit list, not the cross-store shared customer directory. Cross-home-store service support requires a separately reviewed binding/RPC/context policy, not removal of one display check.
