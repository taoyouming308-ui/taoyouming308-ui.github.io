# Prepared DeepSeek chat and speech adapters

These server-only modules are disabled by default and have **no default transport, environment-key reader, secret storage, startup route or deployment**. Tests use generated zero-filled WAVs, fixed fictitious sessions and conspicuously synthetic key strings. They do not contact DeepSeek, create credentials or incur charges. Existing offline/loopback pages remain unrelated. Enabling a model flag is not customer-data or spending authorization.

## Public API

`createDeepSeekProviderAdapter(config).analyze({requestId,credential,scope,session})`

- `config`: `enabled` (default false), `modelConfig:{model,approved:true,maxTokens}`, plus the dependencies below. There is no default model. `model` must be an explicitly reviewed server configuration; `maxTokens` is 1–8192. Neither is accepted from the request body.
- `scope` is exactly `{customerProfileId,visitId,assignmentSource:'appointment'|'frontdesk'}`. It is not the v2 evidence-session schema.
- `session` must be a current, trusted repository-loaded v2 evidence session. Its `scope.customerId` must equal `scope.customerProfileId`, and visit IDs must match. The module validates the entire bounded journal, but a consistently forged client journal is not proof of ownership. The HTTP integration must never accept a client-supplied session as authoritative.
- Uses the existing `buildDesignPilotPrompt` and `validateDesignPilotResult`. The builder's output schema is serialized into a separate fixed system message; user text never becomes a system message. Only the builder's selected source/context projection is sent, not the routing scope, employee identity, session ID or whole journal. Original text can still identify people: this is minimization, **not automatic anonymization**.
- Supports only text and speech-transcript sources. Image descriptions, image bytes, image URLs and extra photo fields are rejected in this prepared stage, including when a caller claims photo consent. Photo authorization and a reviewed media path must be implemented separately.
- Result includes `{requestId,provider:'deepseek',operation:'analyze',actor,scope,payloadSha256,model,sessionId,baseRevision,promptVersion,candidate,requiresReview:true,replayed}`. Candidates are not applied, confirmed, saved or archived. The caller must recheck the current revision and employee permission before any separately authorized append.

`createDeepSeekSpeechAdapter(config).transcribe({requestId,credential,scope,audioBytes})`

- Same dependencies, but no `modelConfig`: the ASR protocol has no model field. `audioBytes` must be an actual `Uint8Array`/Node Buffer, not a URL, path, MIME claim, base64 string or client duration. Input is copied before asynchronous work, then its byte snapshot is validated and sent.
- Result includes the common request/provider/actor/scope/digest metadata and `{operation:'speech',transcript:{kind:'speech_transcript',text,confirmed:false},audio:{sha256,durationMs,sampleRate,channels:1,bitsPerSample:16},requiresReview:true,replayed}`. No audio bytes are stored in the result or attempt ledger. A transcript is not a verified customer statement and still needs review.
- `validateMonoPcmWav(bytes)` is a standalone no-I/O validator returning frozen derived metadata. It does not prove content is synthetic or consented.

## Required trusted dependencies

- `permissionGate.authorize(credential,scope)` uses the existing employee/visit gate and returns `{actor:{username,store},scope}`. It is consulted before reservation, near dispatch and before delivery; a changed employee or scope fails closed. This does not substitute for external transaction/assignment locking.
- `transmissionGate(disclosure)` must return exactly `true` only after verifying the current request's approved employee, exact customer/visit, recipient, purpose, actual payload digest/data kinds and potential charge. Disclosure includes `requestId`, `actor`, `scope`, `provider`, `operation`, `destination`, `model` (null for speech), `payloadSha256`, `byteLength`, `dataKinds`, `purpose`, `mayIncurCharge:true` and `stage`. Stages are `before_reserve`, `before_send`, `before_return`, or `before_replay_return`. These are rechecks of the same exact grant, not permission to consume new approval on each recheck. For ASR the digest/length are of the exact validated WAV part, not randomized multipart framing. A denied or expired grant prevents transmission/delivery. A boolean from a browser is not this dependency.
- `keyResolver({credential,actor,scope,provider,destination,model},useKey)` supplies the current verified employee's key only within `await useKey(key)`. It must invoke/await this callback exactly once and recheck configuration before completing. No owner/system fallback. Errors and results must not expose the key. The runner ignores the resolver's return value and returns only its own validated callback result.
- `transport({url,method,headers,body,redirect,credentials,signal,maxResponseBytes})` is an explicitly injected trusted server implementation, never a browser or arbitrary proxy. URL is exactly `https://api.deepseek.com/chat/completions` or `https://api.deepseek.com/v1/tools/asr`, POST only, `redirect:'error'`, `credentials:'omit'`. Chat body is JSON text; speech body is a `FormData` with one `file` Blob and constant filename `speech.wav`. Let the HTTP implementation supply the multipart boundary. This module supplies no actual network transport. The eventual transport must enforce the URL allowlist at dispatch, not follow redirects, obey cancellation, limit response bytes **while reading**, and never log authorization headers/body/errors. Return `{status,url,redirected:false,headers:{'content-type':...},body:Uint8Array|string}`. The module additionally checks exact final URL, status, MIME, UTF-8, bounded JSON and needed response fields.
- `attemptStore` is a mandatory atomic durable store for production, described below. There is no fallback. `createInMemoryProviderAttemptStore({testOnly:true})` exists solely for isolated tests; process restart loses its protection.
- `timeoutMs` defaults to 30000, integer 1–120000. The transport is invoked at most once. Timeout aborts the signal; a transport must actually honor it. No cancellation claim is made for a provider request already accepted.

## Retry, ledger and failure semantics

`attemptStore.reserve({key,fingerprint})` atomically writes a pending tombstone or reads the existing row. A new row returns `{created:true}`. An existing row returns `{created:false,fingerprint,state,result?}`. `state` is `pending`, `completed`, `uncertain` or `not_sent`. `attemptStore.settle({key,fingerprint,state,result?})` performs an atomic transition from pending only; completed includes `result`, others never do. Identity and request ID form the opaque ledger key; fingerprint additionally binds scope, operation, approved model/endpoint and payload digest. A request ID reused with different input conflicts, including across operations/scopes for that employee.

Persist reservation before calling the callback. Preserve pending/uncertain tombstones across crashes; do not expire them into permission to resend. A completed replay returns only a validated, scope-bound result after fresh authorization and never resolves the key or calls the provider again. Completed results may contain private original source text; protect the ledger as customer data, not as a debug log.

Once transport is invoked, network errors, timeouts, non-200, redirects, malformed JSON, invalid candidate data, revocation, or uncertain ledger settlement conservatively have `outcome:'uncertain'`. They may have incurred a charge. No automatic retry, alternative URL/model, new request ID, or provider idempotency claim is made. Review/reconcile an uncertain attempt before separately authorizing a new attempt. Pre-dispatch failures have `outcome:'not_sent'`; even these are not automatically retried. Every exported error has a fixed code and `retryable:false`, without upstream error/body/key text. Raw and JSON-decoded successful output are checked for key echoes inside the key callback. Provider reasoning/usage/unneeded metadata are not returned. Validated candidate/transcript strings still require escaping at display time.

An external employee system, key store, permission gate, provider and durable ledger cannot be made one atomic transaction by this dependency-injection module. Production wiring needs scoped transaction/locking and operational recovery review. There is no exactly-once billing guarantee across arbitrary new request IDs or a deleted/recreated ledger.

## Real module composition (still disabled; no I/O executed here)

The following is a composition pattern, not an enabled server or new credential flow. All named dependencies must already have been approved and reviewed. `employeeAdapter`, `keySettings`, `durableAttemptStore`, `approvedTransport` and `approvedTransmissionGate` are injected server objects; no real key or environment lookup belongs in this example.

```js
import {
  createDeepSeekProviderAdapter, DEEPSEEK_CHAT_ENDPOINT, DEEPSEEK_ASR_ENDPOINT,
} from './provider-adapter.mjs';
import {createDeepSeekSpeechAdapter} from './speech-adapter.mjs';

const keyResolver = async (context, useKey) => {
  const purpose = context.destination === DEEPSEEK_CHAT_ENDPOINT ? 'chat'
    : context.destination === DEEPSEEK_ASR_ENDPOINT ? 'speech' : null;
  if (!purpose) throw new Error('KEY_DESTINATION_DENIED');
  const metadata = await keySettings.status({credential:context.credential,purpose});
  if (!metadata.configured || metadata.destination !== context.destination ||
      metadata.model !== context.model) throw new Error('KEY_CONFIGURATION_MISMATCH');
  return keySettings.withProviderKey({
    credential:context.credential,
    expectedRevision:metadata.revision, // trusted status for this exact purpose slot
    destination:context.destination,
    model:context.model,
  }, async lease => {
    if (lease.actor.username !== context.actor.username ||
        lease.actor.store !== context.actor.store ||
        lease.destination !== context.destination || lease.model !== context.model)
      throw new Error('KEY_ACTOR_OR_CONFIGURATION_CHANGED');
    return useKey(lease.key); // returns only the adapter's validated result, never lease/key
  });
};
const common = {
  enabled:false, // no automatic activation
  permissionGate:employeeAdapter.gate,
  transmissionGate:approvedTransmissionGate,
  keyResolver,
  transport:approvedTransport,
  attemptStore:durableAttemptStore,
};
const provider = createDeepSeekProviderAdapter({...common,modelConfig:approvedModelConfig});
const speech = createDeepSeekSpeechAdapter(common);
// Only a trusted handler may later call these with its verified credential and
// repository-loaded evidence session; the public request cannot pick model/key/URL.
```

Chat and speech key slots/config approvals remain independent. A configured chat key never silently authorizes ASR with that key. This composition does not install the cryptographic secret, save a key, approve a model, enable a route, or grant data/fee authorization.

## Strict WAV subset and official references

Official [ASR endpoint](https://api-docs.deepseek.com/api/asr/) and [ASR guide](https://api-docs.deepseek.com/guides/asr/) were checked on 2026-11-15. The service accepts a complete file per request, not streaming audio; it documents PCM16 WAV or Ogg Opus, maximum 120 seconds and 8 MiB, and stereo recognition of the left channel only.

This adapter intentionally supports less: little-endian RIFF/WAVE with exactly `fmt ` size 16 followed by one `data` chunk, uncompressed PCM format 1, 16 bits, **mono only**, and rates 8000/16000/22050/24000/32000/44100/48000 Hz. Magic bytes, RIFF size, file boundary, byte rate, block alignment, data length, complete sample frames and derived duration are checked against actual bytes. Unknown/extra chunks and trailing data are rejected, not passed through as hidden metadata. Ogg parsing is not implemented and is explicitly rejected even with an Opus MIME label. Stereo is rejected rather than silently dropping the right channel. No automatic transcoding/downmixing occurs.

Both limits apply independently. 120 seconds at 44.1 kHz PCM16 mono needs 10,584,044 bytes including the basic header, which exceeds 8 MiB; stereo needs 21,168,044 bytes. A 120-second 32 kHz mono file fits. The HTTP multipart total may exceed the file's 8 MiB by framing overhead; the handler must bound both separately. Response duration is an integer in milliseconds and must agree with the byte-derived duration within 2 ms; a live codec/provider integration has not been tested.

[Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/) and [JSON Output guide](https://api-docs.deepseek.com/guides/json_mode/) support the selected endpoint/JSON protocol. The local adapter rejects blank JSON, non-stop/truncated output and tool-call responses rather than automatically retrying. It intentionally makes no assertion about currently approved model names, model quality or availability. The existing prompt remains labelled as a prepared local trial.

## Tests

`node scripts/test-design-provider-adapter.mjs` runs synthetic protocol, scope, auth/consent, secret-redaction, concurrent/idempotent/uncertain-retry, malformed-response and real-byte WAV boundary checks. No fetch is allowed. A passing mock suite is not a production provider, billing, authentication, secure key-entry or real microphone test.
