# Academy connected publication

This is a content-only companion to the existing publishing, backup, collaboration and no-downtime rules. It does not waive any rule, approve a lesson, require customer data, or modify business permissions. The daily authoring task has user authorization to publish reviewed lessons without asking for another editorial confirmation.

## Two cooperating executors

1. The connected publisher reads current main and all required governance files, verifies source/rights/privacy and exact draft/asset review hashes, and opens or reuses a focused `content/academy-...` branch and draft PR. It must not equate a task schedule with successful publication.
2. `Academy publication preflight` checks out immutable latest main, runs the existing preflight and backup script, and retains a verified public-source recovery point. Wait for its successful SHA-bound evidence before adding lesson inputs. This archive is not a claim to back up a private workstation or production database.
3. Commit only reviewed dated drafts/reviews/local images, preserving their actual approval provenance. The existing `Publish reviewed academy lessons` workflow prepares this branch on push. It again backs up clean latest main before generating anything, consumes the trusted main publisher, renders dated HTML, rebuilds the entire catalog and its static fallback, and prepends an idempotent note to the existing handoff/changelog. The script never generates approval or changes app versions.
4. The cloud preparer runs the complete existing pre-push gate, then makes one ordinary fast-forward push to the same content branch. A stale main, moved branch, missing review, invalid asset, or failed test stops it. No main push, force push, permission repair or implicit merge exists in this job.
5. Read the resulting branch head and prepared artifact. A default GITHUB_TOKEN preparation push does not supply automatically accepted protected CI/Pages publication. The connected publisher records the verified preparation in `academy/publication-status/YYYY-MM-DD.json` using its existing authenticated GitHub write tool. This ordinary connected commit triggers the exact-head PR checks. The cloud preparer is idempotent and makes no further commit when inputs/rendering are unchanged.
6. Require success from both the backup gate and the complete `Validate shared app` for that exact final PR head. Resolve all additional repository requirements without bypass. Mark the PR ready only after these gates, then perform a normal merge using the expected head SHA.
7. Re-read current main HTML/catalog and verify actual Pages content and images. The read-only `verify-main-pages` job compares SHA-256 of catalog, static fallback, all lessons and reviewed images to checked-out main, with bounded retries; retain its report. Only successful actual readback permits `App同步：已上线`.

The existing UTC 00:15 schedule and manual main task retain their reviewed-candidate handoff. They do not invent drafts or automatically approve them. The ChatGPT daily authoring/publishing task performs the connected steps, without another user review request. No extra schedule, PAT, GitHub App secret or new workflow token permissions are required for this path.

## Retry and scope rules

- Dates use Asia/Shanghai and stable `academy/YYYY-MM-DD.html`. Reuse the existing PR/branch for a retry. Never duplicate a same-day lesson or replace current history with a stale ZIP catalog.
- When main advances, merge/rebase it normally in the candidate branch, review conflicts, and rerun backup/preparation/checks. Never force a stale tree over main.
- The prep allowlist excludes `perm-app.html`, versions, Supabase, login, financial and customer business code. Only lesson content, this narrowly scoped publishing infrastructure and required governance notes are allowed.
- A failed pre-push or unclear network write must be investigated by remote readback, not blindly repeated. Read-only Pages checks are bounded and do not change production.
- If an actual GitHub permission/security check rejects an action, stop that action and report it; do not switch identities or routes to bypass the rejection.
- Any failure leaves existing main lessons intact. Report the failing stage, relevant PR/run and real status. A prepared artifact, successful commit or enabled daily task is not an online lesson.

## Initial recovery

Only 2026-10-15 and 2026-10-16 are the requested backfill. October 5 was a user typo and is not authorized by that message. Preserve October 11-14. The existing lesson source-and-rights reviews are reused unchanged; content-hash validation is not new scientific validation.

Useful local isolated test: `python3 -m unittest scripts/test_prepare_academy_pr.py`.
