#!/bin/bash
set -euo pipefail

REPO_ROOT="${MGJ_REPO_ROOT:-/Users/a1/Documents/Codex/2026-06-20/perm-pages}"

exec /usr/bin/python3 /Users/a1/.hermes/scripts/check_mgj_sync_health.py \
  --repo-root "$REPO_ROOT" \
  --quiet-healthy
