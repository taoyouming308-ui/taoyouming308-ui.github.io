#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.freecraftsman.aesthetic-knowledge-collector"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/.hermes/logs"
RUNTIME_ROOT="$HOME/.hermes/aesthetic-knowledge/runtime"

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR" "$HOME/.hermes/aesthetic-knowledge/pending" "$RUNTIME_ROOT/scripts"
cp "$ROOT/scripts/run-aesthetic-knowledge-collection.sh" "$RUNTIME_ROOT/scripts/"
cp "$ROOT/scripts/collect-aesthetic-candidates.js" "$RUNTIME_ROOT/scripts/"
cp "$ROOT/scripts/aesthetic-sources.json" "$RUNTIME_ROOT/scripts/"
chmod 700 "$RUNTIME_ROOT/scripts/run-aesthetic-knowledge-collection.sh"

for file in run-aesthetic-knowledge-collection.sh collect-aesthetic-candidates.js aesthetic-sources.json; do
  if [[ "$(shasum -a 256 "$ROOT/scripts/$file" | awk '{print $1}')" != "$(shasum -a 256 "$RUNTIME_ROOT/scripts/$file" | awk '{print $1}')" ]]; then
    echo "install failed: runtime hash mismatch for $file"
    exit 1
  fi
done

/usr/bin/python3 - "$TARGET" "$RUNTIME_ROOT" "$LOG_DIR" <<'PY'
import plistlib
import sys

target, root, log_dir = sys.argv[1:]
payload = {
    "Label": "com.freecraftsman.aesthetic-knowledge-collector",
    "ProgramArguments": [f"{root}/scripts/run-aesthetic-knowledge-collection.sh"],
    "WorkingDirectory": root,
    "StartCalendarInterval": {"Hour": 2, "Minute": 30},
    "StandardOutPath": f"{log_dir}/aesthetic-knowledge-collector.log",
    "StandardErrorPath": f"{log_dir}/aesthetic-knowledge-collector.error.log",
    "ProcessType": "Background",
}
with open(target, "wb") as handle:
    plistlib.dump(payload, handle, sort_keys=False)
PY

chmod 600 "$TARGET"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$TARGET"
launchctl enable "gui/$(id -u)/$LABEL"

echo "installed: $LABEL at 02:30 Asia/Shanghai local time"
