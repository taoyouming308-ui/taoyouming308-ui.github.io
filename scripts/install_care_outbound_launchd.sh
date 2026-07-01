#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LABEL="com.freecraftsman.care-outbound"
DOMAIN="gui/$(id -u)"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"

"$SCRIPT_DIR/deploy_care_outbound_worker.sh"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.hermes/logs"
cp "$SCRIPT_DIR/$LABEL.plist" "$TARGET"
plutil -lint "$TARGET" >/dev/null

launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "$DOMAIN" "$TARGET"
launchctl enable "$DOMAIN/$LABEL"
launchctl kickstart -k "$DOMAIN/$LABEL"

echo "自由手艺人护理出库后台任务已启用"
