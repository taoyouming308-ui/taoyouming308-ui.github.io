# Stage 21: controlled image-worker deployment options

> Stage26 clarification: these Linux requirements apply to this local-worker implementation, not every possible image-processing architecture. Existing Supabase Pro private transformations are now the preferred alternative under evaluation. See [managed-image review](STAGE26-MANAGED-IMAGE-REVIEW.md); no VM purchase or hosted activation is authorized by this document.

Status: assessment only, 2026-11-16. No environment was created, image built/pulled/run, software installed, permission changed, credential configured, or customer data copied. No PG/browser workload was run for this assessment. Neither option below is authorized or immediately deployable.

## Fresh environment evidence

This stage re-listed connected environments and saved configurations, inspected the Mac, attached to the existing cloud environment for read-only checks, then returned to the Mac. These are current observations, not a claim that earlier negative tests were rerun.

| Existing environment | Observed | Qualification gap |
| --- | --- | --- |
| `wuming-3.local` | Darwin, UID 501. Existing Docker reports built-in seccomp and cgroup namespaces, cgroup v2, `cgroupfs`, no rootless flag. | Not the production factory's nonroot Linux/rootless/systemd host. |
| Dot cloud computer | Linux 6.18.57, UID 1000, Node/Python, ImageMagick 7.1.1-43. No Docker, Podman or nerdctl executable; `/sys/fs/cgroup`, `/run/user/1000`, and checked Docker sockets absent. PID 1 reports `codex`. Python reports RLIMIT_AS available with current unlimited values. | No available controlled container launcher or visible delegated cgroup boundary. Availability of RLIMIT_AS or a decoder executable does not demonstrate enforced aggregate isolation. |
| Saved configurations | Default configurations and a repository-backed configuration; no qualified worker configuration identified. | A saved repository configuration is not evidence of a suitable host, image or service identity. |

The Mac's initial sandboxed Docker read was denied; the separately approved read-only inventory succeeded. That sandbox denial is not a worker-isolation negative test. The image inventory contains PostgreSQL/Supabase components, including imgproxy, but no identified approved image implementing this worker's pinned protocol. An imgproxy image is **not** a compatible substitute merely because it processes images.

The existing factory's Mac rejection and prior limited Linux negative checks remain described in `PRIVATE-IMAGE-WORKER.md`. This assessment did not rerun them. No current environment qualifies for the production path; do not disable seccomp, bypass rootless checks, pretend a synthetic whitelist is production validation, or weaken the native memory fail-closed rule.

## Option A: separately approved self-hosted broker

Minimum target is a dedicated nonroot Linux broker identity on a reviewed host with systemd, cgroup v2, delegated memory/CPU/PID controllers, and a local rootless Docker daemon supported by the current driver. Select the host/region, service owner, operating budget and security policy before provisioning. No supplier availability or price has been verified here.

Required decisions and implementation work:

1. Approve the host/service identity and daemon boundary. The public Web/Edge process must not receive a Docker socket or host-control capability. Deno Edge cannot execute the current Node/native driver.
2. Approve a minimal Python/ImageMagick build and native dependency baseline, record SBOM/vulnerability review, and pin the resulting immutable image digest. Existing local ImageMagick versions are not a security approval. Use `--pull never` at execution; requests cannot select image, executable, path, command or environment.
3. Implement an authenticated, bounded app-to-broker channel and its service authorization. Choose local IPC or private authenticated transport explicitly; no listener, credential or persistent grant exists merely because an interface is documented. Bind requests to exact input digest, operation, limits and authorization context; recheck before processing and before delivery. Never accept public image URLs as a shortcut.
4. Implement global admission/backpressure, cancellation, wall-clock containment, daemon restart reconciliation and orphan cleanup. Per-instance concurrency limits alone do not bound a multi-process deployment.
5. Keep model keys, database credentials and employee tokens out of image containers. Broker needs only its reviewed worker daemon and narrowly scoped service authentication, not customer DB/model credentials. No payload logging; define temporary-byte retention/deletion and safe diagnostic fields.
6. Integrate returned derivative digest/provenance and independent full decoding with existing media and external-processing gates. Private storage permission is not derivative-processing or provider-transmission approval. Metadata stripping is not anonymization.

The existing container policy (no network, read-only root, nonroot UID, dropped capabilities, no-new-privileges, private namespaces, bounded tmpfs/resources and disabled container logging) remains necessary, not sufficient proof of security.

## Option B: separately approved managed isolated broker

A managed execution service could supply the controlled job boundary instead of giving the application daemon access. No suitable service, account, region, pricing or installed configuration has been established. This is an alternative requiring discovery, approval, implementation and validation, not a deployment recommendation or a fallback flag in the current Docker factory.

A new adapter would have to preserve the same bounded protocol and demonstrate:

- An immutable reviewed worker image/runtime, no arbitrary user-selected command or image, nonroot execution and documented enforced aggregate resource limits.
- No image-worker egress, no host filesystem access, no credential injection into jobs, and no provider-side payload logging or unapproved retention.
- App-only authenticated submission, precise per-request data/processing authorization, cancellation and outcome/status reconciliation without automatic duplicate processing after uncertain submission.
- Exact response-to-request digest binding, strict output limits and independent decode verification, concurrency quotas and cleanup evidence.
- An approved data region, processor/retention terms, service identity, cost controls and operational ownership. Sending private originals to that service is itself a separately authorized data transfer, even if it is not the model provider.

Managed-service descriptions or caller-supplied isolation booleans cannot replace observed target-environment evidence. The existing local factory must continue to reject incompatible hosts rather than being bypassed to fit this option.

## Acceptance after explicit approval

On the actual selected target, using synthetic inputs first:

1. Verify host/runtime identity, image digest, effective security options and delegated controllers; reject mismatches before sending image bytes.
2. Prove enforced aggregate memory, CPU and PID limits under controlled bounded tests; test wall-clock timeout, child-process termination, crash, cancellation, saturation and restart/orphan cleanup. Do not run uncontrolled stress against the owner's shared machine.
3. Test denial of outbound network/DNS, protected host reads/writes, privilege escalation and core dumps; verify no unintended mounts, devices, ports or secrets. Configuration inspection alone is insufficient.
4. Run full native decode and malformed/truncated/multiframe/pixel-limit corpus tests. Verify orientation handling, fresh PNG construction and removal of ancillary metadata without claiming visual anonymization.
5. Exercise expired/revoked identity and processing approvals during waits; prove no derivative/result delivery after failed final verification. Validate original/derivative digest binding and that model transmission still needs its own exact recipient/purpose/content/cost approval.
6. Exercise lost replies, uncertain submission and cleanup failure without blind duplicate submission; verify bounded status reconciliation and safe errors/logs.
7. Run representative concurrent and growing-history application tests through the real selected driver/broker. Synthetic test pools and short fixtures do not certify production throughput or availability.

## Work possible without host changes

Pure protocol/mock tests and explicitly synthetic decoder functionality checks can continue with existing tools. They cannot certify the missing production isolation boundary. A qualified controlled-worker integration test is blocked by the absence of an approved compatible host and worker image, plus the unimplemented authenticated broker/supervision integration above. No security relaxation is proposed to remove that blocker.
