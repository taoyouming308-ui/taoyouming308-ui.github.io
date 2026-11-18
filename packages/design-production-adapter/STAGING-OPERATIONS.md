# Isolated staging operations — not a production installation

Stage43 supplies an explicit non-model service lifecycle and read-only image
host preflight. They do not provision a server, DB schema/role, employee identity,
receipt issuer, TLS ingress or backup system. An operator must bind real staging
capabilities before a listener starts. Never import the finite test receipt
issuer or run `drafts/*fixture.sql` on a live installation.

## Start and stop

`startDesignStagingService` accepts only `{enabled:true,publicOrigin,port,
dependencies}`. `dependencies` contains exactly:

- `acquireClient`: the restricted trusted PostgreSQL adapter, not an owner pool;
- `worker`: the mTLS broker client, with inspect/normalize/derive;
- `mediaApprovalVerifier`: independently provisioned, current receipt authority;
- `storageOrigin`: fixed original-media logical namespace;
- `privateMediaTransport`: current-authority encrypted private object transport;
- `verifyReady({signal})`: real site-specific readiness checks, returns true;
- `close()`: closes owned resources, including on startup failure.

All dependencies must already point to a separate staging environment. A name,
URL label or `verifyReady:true` is not proof of isolation. Readiness must exercise
the restricted DB role/schema contract, current independent identity/receipts,
protected local object directory/key and the pinned mTLS worker. Test both
allowed and denied access using permitted staging identities. Do not probe a
customer object, seed a real model key or issue a paid request for health checks.

Readiness has a 10-second deadline and abort signal. It must honor cancellation
and stop using resources before `close()` completes. No listener is opened until
readiness succeeds. Models are unconditionally false; model configuration is
not accepted by this entry. The existing exact-origin and employee authorization
remain in force. The listener binds 127.0.0.1 only; a reviewed HTTPS ingress must
forward the original allowed Origin header. Neither static files nor health
details are publicly served by this listener. Local `status()` is not an
independent health proof or a cached authorization decision.

Shutdown first stops the listener, then attempts dependency cleanup even after
a drain failure. Both steps have a five-second bound; cleanup uncertainty is an
explicit failure, never a success/retry signal. `close()` is idempotent. Do not
configure automatic write replay or concurrent old/new writers during restart.
Unknown upload outcomes require the same original request ID and readback.

The optional operator entry is:

```sh
node scripts/serve-design-staging.mjs \
  --bootstrap /absolute/private-staging/bootstrap.mjs \
  --origin https://your-reviewed-staging-host.example --port 4281
```

The bootstrap is trusted operator code outside the release. Its owner-only
0700 directory and 0600 regular `.mjs` file export
`prepareDesignStagingDependencies()`, returning the capability object above.
Never place credentials in the public repository, command line or chat. The
bootstrap factory must clean partial construction failures itself; the service
owns returned capabilities once its configuration validates. Invalid config
does not transfer ownership. SIGINT/SIGTERM after startup close the service;
supervisor shutdown during bootstrap remains the bootstrap's responsibility.
Only fixed lifecycle status is logged. No bootstrap for a real environment has
been supplied or installed in this delivery.

## Image host preflight

```sh
node scripts/preflight-design-phone-host.mjs --image sha256:YOUR_REVIEWED_DIGEST
```

This read-only command accepts an immutable image digest only. It neither pulls
nor creates a container. The actual host must be Linux arm64, non-root, with
its own rootless Docker socket and systemd cgroup v2 resource controls; the image
must exist as Linux arm64. The production worker repeats the host check before
each job. Mac offline qualification is separate and cannot pass this probe.
Reported capabilities still need negative enforcement tests on the target host.
The web account must not receive the Docker socket or image-broker private key.

## Acceptance before a later deployment

Keep metadata, encrypted objects and the separately protected encryption master
in a consistent backup set. Stop new writes or use a reviewed consistent
snapshot, record immutable version/object digests, restore to an isolated target
and verify authorized byte-identical readback plus wrong-employee denials. The
Stage42/43 test restored objects with existing metadata. Stage44 now tests a
separate empty PG17 cluster plus DB/roles/objects/media-master recovery after
removing the original synthetic environment; see [offline recovery](OFFLINE-RECOVERY.md).
Production backup/escrow, retention/deletion and real host recovery remain unaccepted.

The original snapshot's v691 label is not a published release. Integration must
start from then-current GitHub main and preserve its phone-login/booking fixes.
Any local version reservation must be rechecked before a protected release;
there has been no push, production SQL, booking sync or API activation here.
Physical iPhone HEIC/HEIF, TLS ingress and staging authority provisioning remain
separate acceptance items. Local passing tests do not make this production ready.

## Existing homepage preservation

The integrated homepage uses the small `ai-design-entry.js` loader. It loads no
design module graph or host credential before an explicit entry click. The old
form/booking startup remains independent; an optional module failure preserves
current input and offers a separate-window fallback. The original design module
still defaults closed and must receive trusted activation configuration. This
is not a new authorization source or a browser model-key setting.
