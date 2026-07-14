#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LABEL="com.freecraftsman.care-outbound"
KEEPALIVE_LABEL="com.freecraftsman.care-outbound-keepalive"
DOMAIN="gui/$(id -u)"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
KEEPALIVE_TARGET="$HOME/Library/LaunchAgents/$KEEPALIVE_LABEL.plist"

"$SCRIPT_DIR/deploy_care_outbound_worker.sh"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.hermes/logs"
cp "$SCRIPT_DIR/$LABEL.plist" "$TARGET"
cp "$SCRIPT_DIR/$KEEPALIVE_LABEL.plist" "$KEEPALIVE_TARGET"
plutil -lint "$TARGET" >/dev/null
plutil -lint "$KEEPALIVE_TARGET" >/dev/null

launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
launchctl bootout "$DOMAIN/$KEEPALIVE_LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "$DOMAIN" "$TARGET"
launchctl bootstrap "$DOMAIN" "$KEEPALIVE_TARGET"
launchctl enable "$DOMAIN/$LABEL"
launchctl enable "$DOMAIN/$KEEPALIVE_LABEL"
launchctl kickstart -k "$DOMAIN/$LABEL"
launchctl kickstart -k "$DOMAIN/$KEEPALIVE_LABEL"

echo "自由手艺人护理出库与独立会话保活后台任务已启用"
