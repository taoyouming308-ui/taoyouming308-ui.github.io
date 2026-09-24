# ZYSYR production release matrix

Snapshot date: 2026-09-24 (Asia/Shanghai). This is an observed deployment inventory, not a guarantee that settings remain unchanged. Re-run the read-only checks before every release. Secret values and user data must never be copied into this document.

## Verified runtime baseline

| Layer | Observed production baseline | Release boundary |
|---|---|---|
| Web app | GitHub Pages, static/no build; `version.txt` = v537 | GitHub `main` is the publication source. Do not publish Gitee or force-refresh users. |
| Database | Supabase project `pdssrmpeiuwvxzsgschm`; ACTIVE_HEALTHY; PostgreSQL 17.6.1.127; Pro organization | Migrations are tracked under `supabase/migrations/`. Production migration inventory was read through `20260924051925` on 2026-09-24. Never infer that a local migration is deployed from its filename alone. |
| Main finance API | `operations-api` v95 ACTIVE; `verify_jwt=false`; the function performs its own finance/employee session checks | Bundle includes `deno.json` and relative dependencies. Keep the existing finance login route and validate anonymous requests remain rejected. |
| Finance Auth | `operations-auth` v6 ACTIVE; `verify_jwt=true` | Uses publishable key (legacy anon-key fallback only where configured); no service-role key in this function. |
| Auth migration | `operations-auth-migrate` v6 ACTIVE; `verify_jwt=false` | Custom login/rate-limit checks are in-function. Keep the approved migration allowlist and do not remove legacy fallback before account migration is verified. |
| Auth administration | `operations-auth-admin` v7 ACTIVE; `verify_jwt=true` | Server-side service-role operations; administrator authorization remains mandatory. |
| Employee bookings | `employee-bookings-api` v4 ACTIVE; `verify_jwt=false` | Requires its internal employee session check; do not treat `verify_jwt=false` as public access. |
| Staff administration | `staff-access-api` v2 ACTIVE; `verify_jwt=false` | Requires its internal administrator session check. |
| Voucher OCR worker | `voucher-ocr-worker` v5 ACTIVE; `verify_jwt=false` | Must validate worker secret before processing. Recognition remains a candidate, never automatic financial posting. |
| AI worker | `operations-ai-worker` v4 ACTIVE; `verify_jwt=false` | Must validate worker secret before processing. |

## Server environment variable names

This list is derived from tracked Edge Function code. It intentionally contains names only, never values. Confirm actual configured names in the Supabase project before deploying a function; missing secrets must not be papered over with client-side values.

| Function(s) | Variable names read by code | Handling note |
|---|---|---|
| `operations-api` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ZYSYR_WORKER_SECRET`, `SILICONFLOW_API_KEY`, `ZYSYR_DAILY_CODEX_BRIDGE_URL`, `ZYSYR_DAILY_CODEX_BRIDGE_TOKEN`, `ZYSYR_DAILY_CODEX_MODEL`, `ZYSYR_AI_API_KEY`, `DEEPSEEK_API_KEY`, `ZYSYR_AI_BASE_URL`, `DEEPSEEK_BASE_URL`, `ZYSYR_AI_MODEL`, `ZYSYR_AI_PROVIDER` | Service-role and bridge tokens stay server-only. AI/OCR provider settings are optional features; manual finance entry remains the fallback. |
| `operations-auth` | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY` | Publishable key preferred; never add service-role key. |
| `operations-auth-migrate` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY` | Service-role access is server-only; the public key is for Auth token exchange. |
| `operations-auth-admin`, `employee-bookings-api`, `staff-access-api` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Service-role access is server-only and must be protected by each function's session/role checks. |
| `voucher-ocr-worker` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ZYSYR_WORKER_SECRET`, `SILICONFLOW_API_KEY`, `SILICONFLOW_BASE_URL`, `ZYSYR_OCR_MODEL` | Keep bucket access private; do not log document content or tokens. |
| `operations-ai-worker` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ZYSYR_WORKER_SECRET`, `ZYSYR_AI_API_KEY`, `DEEPSEEK_API_KEY`, `ZYSYR_AI_BASE_URL`, `DEEPSEEK_BASE_URL`, `ZYSYR_AI_MODEL`, `ZYSYR_AI_PROVIDER` | Worker-only; do not move provider secrets to Pages. |

## Reproducibility gaps still open (C06)

- Repository CI pins Node.js 22.22.1 via `.node-version`, pins Playwright 1.62.1, installs Chromium and uses `ubuntu-24.04`. Local pre-push and GitHub Actions now run the same 63-command finance regression manifest; PostgreSQL 17 fixtures are isolated in local Docker containers with container networking disabled. The manifest ran locally with all 63 commands passing; its first GitHub Actions run exposed two macOS-only `/private/tmp` screenshot paths. Both tests now use the system temporary directory and passed locally; CI rerun remains pending.
- Local Supabase CLI reported version 2.109.1. Its `--help` invocation failed because this sandbox cannot write the CLI telemetry file under `/Users/a1/.supabase`; no deploy command was guessed or run. CI does not currently pin/install the Supabase CLI or perform production deployment.
- Current production migrations/functions/Pages were inspected read-only on 2026-09-24. The latest production migration version is an observation, not a command to replay or a target for rollback.
- Before C06 can close: verify the full GitHub Actions result, pin and exercise CLI/Edge/database deployment checks in CI or document an equivalent controlled release runner, verify the environment-variable names against actual function settings, and retain successful GitHub Actions run links plus live auth/version probes.

## Safe release checks

1. Read `AGENT_SYNC_STATUS.md`, compare local Git SHA/version with GitHub `main`, and confirm the worktree is clean.
2. Run the repository version and release-integrity checks and the full pre-push gate. Do not use `--no-verify`.
3. For schema changes, review the exact migration and rollback/forward-fix plan; verify the production migration inventory before and after application. Never run a recovery restore against production as a test.
4. Deploy Edge Functions only as complete bundles with entrypoint, import map, and relative dependencies; verify ACTIVE version and custom auth behavior after deployment.
5. Publish static Pages from GitHub `main`; verify the uncached version and critical route behavior after propagation.
6. Keep finance data read-only during release verification. Do not use test logins to post, revise, delete, or lock real financial records.
