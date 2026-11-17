# Stage33: normalized-object persistence and strict-format limits

Offline implementation and synthetic tests only. No production migration, permission change, credential, real customer data, hosted transform, model call, fee, download, push or deployment. App remains v686; these server-only modules are not public-shell assets.

## What the real decoder experiment established

A conservative JPEG SOF0/single-scan and static lossy VP8 subset parser rejects outer trailing bytes, unsupported chunks/markers, malformed lengths, metadata outside a small generated-EXIF subset, frame/profile variants and truncated envelopes. Its result explicitly says `fullyConsumed:false`, `fullyDecoded:false`, `qualified:false`. It is not an entropy/VP8 decoder.

Actual installed digest-pinned imgproxy accepted all six synthetic normal, outer-tail and compressed-internal-tail fixtures with HTTP 200. Independent ImageMagick with `-regard-warnings` also returned exit 0 and complete pixel buffers. JPEG internal-tail emitted a warning despite that exit status; WebP internal-tail did not supply an equivalent reliable rejection. Thus exit success, full pixels, RIFF bounds, and the warning flag cannot certify complete compressed-stream consumption. These tests deliberately feed adversarial *synthetic* inputs to the isolated decoder, never to a consume/store/model path.

With actual original source bytes and the same fixed local encoder digest, transform parameters and configuration, two independent reconstructions each of JPEG and WebP exactly matched their original stored parent bytes and differed from modified fixtures. This supports researching a **narrow fixed-producer provenance verifier**, not declaring arbitrary bitstreams fully consumed or assuming hosted Supabase uses the same version/configuration. Such an independent production runtime has not been installed or enabled. Unknown compressed-stream qualification stays closed.

## Additive three-object chain

`source record/object/version → exact hosted response + private parent object/version → pending normalization artifact → new private normalized PNG object/version → independently assigned verifier task → separate report`

The old response, hashes and v1 verifier retain their meaning. Normalized PNG is never inserted as a replacement hosted derivative. The new artifact, object receipt and report bind all three versions/hashes, immutable authority, exact parent request/digest, fixed normalization policy and independently assigned verifier/policy. `sourceBinding` must prove source→parent; `parentBinding` must prove parent→normalized pixels. Metadata removal applies to the final PNG, not an unsupported claim that a parent retaining generated EXIF is metadata-free.

Storage success and `readbackVerified` prove only byte equality. Even a complete report structurally grants no model submission, adoption or public access. Production trust comes from independent approved runtime/roles and current task/ancestor authorization, never from self-consistent JSON.

## Persistence and role design

The new isolated SQL draft adds normalized storage approvals, once-put claims, immutable objects, verifier tasks and reports. It references existing immutable identity and original source/processing/cost/parent-store approvals rather than copying them. Parent lookup uses the exact original digest/request, not the latest response. New independent storage-issuer, verifier-authorizer and verifier roles cannot be replaced by the old derived roles or ordinary runtime.

A successful claim permanently consumes its once slot. Missing/uncertain put, publish or COMMIT acknowledgements do not trigger another write. Fresh authorization is checked around I/O and transactions. Revocation stops authorized use but does not promise that already written private bytes vanish. No absolute authorization-at-physical-COMMIT-time guarantee is asserted beyond the documented bounded transaction checks and lock model.

The independent runner privately reads the exact three object versions, invokes the separate verifier, publishes through the verifier role and rechecks task binding. It does not get ordinary runtime status privileges. Callers use the existing current runtime identity separately for durable status recovery. A publication attempt followed by timeout, revocation or lost acknowledgement is uncertain, not not-saved, and is not automatically retried.

## Deliberately not completed by JSON or mocks

- Qualified production full compressed-stream verifier or a fully integrated fixed-producer provenance runtime.
- Pre-decode durable normalization processing authorization/once-claim. A post-decode storage approval is not that permission. Existing normalization callback mocks must not be enabled in production.
- Real private object-store immutability/version guarantees and actual storage deployment.
- New normalized report integration into model/candidate/adoption paths, which remain separately closed.
- Hosted actual image switch, usage, Spend Cap and pricing exposure; real model quality and latency; original intermittent PG root cause.

## User steps, only after engineering gates

No API key is needed now. First the owner can sign into the existing Supabase dashboard to allow read-only Usage/Billing/Storage-setting checks; do not change Spend Cap or activate transforms automatically. Any later hosted synthetic test needs an identified organization/project/region, bounded storage/transform/compute budget and explicit upload/service approval. Real customer processing additionally requires the precise data/recipient/purpose authorization. A personal provider key should then be entered through a secure server-backed setup, never chat. Start with the owner only; no employee rollout or automatic migration of old identities.

## Evidence retained during this stage

The new and retained pure aggregate passed 189 checks. The initial isolated PG smoke stopped at 1/4 because a synthetic JPEG response lacked its required magic prefix; the fixture was corrected, not the existing transform sniff. The corrected four-check smoke passed with actual restricted PostgreSQL roles and the full independent report/readback path, using mock bytes/storage/binary inspection. Exact fixture containers, pools and relays were removed.

The first runner pure run passed 24/27. Two error-label failures exposed a composed guard throwing its wrapper error through the verifier's deliberate sanitization; returning strict boolean guard results preserves DENIED without trusting foreign errors. One assertion incorrectly tried to prohibit JavaScript Promise assimilation of a callback's top-level thenable Proxy; it was narrowed to untrusted JSON proxy/getter rejection rather than claiming control over native Promise behavior. The corrected runner passed 27/27, with final added coverage passing 29/29; initial logs remain in private synthetic evidence.

Final actual isolated PostgreSQL regression passed 17/17, including the independent runner, forbidden old-role/new-role crossover and SET ROLE, forced RLS/nonowner catalog assertions, malformed/old reports, concurrent once claims, lost COMMIT acknowledgement, expiry and revocation. A separate fresh case revoked only the new normalized-storage permission: new object/task reads and renewal failed, while the exact old parent remained readable and no extra PUT occurred. Epoch invalidation and forged subject rejection were tested; a full real same-name rehire lifecycle was not newly tested. Earlier 16/16 logs are retained with that title limitation corrected in the final script. All exact fixture containers, pools and relays were cleaned.
