#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${AESTHETIC_ENV_FILE:-$HOME/.hermes/.env}"
OUTPUT_DIR="${AESTHETIC_CANDIDATE_DIR:-$HOME/.hermes/aesthetic-knowledge/pending}"
LOCK_DIR="${TMPDIR:-/tmp}/dss-aesthetic-knowledge-collector.lock"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "collection skipped: another run is active"
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

if [[ ! -f "$ENV_FILE" ]]; then
  echo "collection failed: environment file not found"
  exit 1
fi

while IFS='=' read -r key value; do
  case "$key" in
    DEEPSEEK_API_KEY|DEEPSEEK_BASE_URL|DEEPSEEK_MODEL)
      value="${value%$'\r'}"
      if [[ "$value" == \"*\" && "$value" == *\" ]]; then value="${value:1:-1}"; fi
      if [[ "$value" == \'*\' && "$value" == *\' ]]; then value="${value:1:-1}"; fi
      export "$key=$value"
      ;;
  esac
done < "$ENV_FILE"

if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
  echo "collection failed: DEEPSEEK_API_KEY is not configured"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
NODE_BIN="${NODE_BIN:-}"
if [[ -z "$NODE_BIN" ]]; then
  for candidate in /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node; do
    if [[ -x "$candidate" ]]; then NODE_BIN="$candidate"; break; fi
  done
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "collection failed: Node.js runtime not found"
  exit 1
fi

"$NODE_BIN" "$ROOT/scripts/collect-aesthetic-candidates.js" \
  --sources "$ROOT/scripts/aesthetic-sources.json" \
  --output "$OUTPUT_DIR"
