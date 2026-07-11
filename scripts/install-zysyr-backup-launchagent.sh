#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_SCRIPT="$PROJECT_ROOT/scripts/backup-zysyr.sh"
LABEL="com.zysyr.daily-backup"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/ZYSYR"

mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"

escaped_script=$(printf '%s' "$BACKUP_SCRIPT" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g')
escaped_log=$(printf '%s' "$LOG_DIR" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g')

tmp_plist="$(mktemp)"
trap 'rm -f "$tmp_plist"' EXIT

printf '%s\n' \
  '<?xml version="1.0" encoding="UTF-8"?>' \
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
  '<plist version="1.0">' \
  '<dict>' \
  '  <key>Label</key>' \
  "  <string>$LABEL</string>" \
  '  <key>ProgramArguments</key>' \
  '  <array>' \
  "    <string>$escaped_script</string>" \
  '  </array>' \
  '  <key>StartCalendarInterval</key>' \
  '  <dict>' \
  '    <key>Hour</key><integer>2</integer>' \
  '    <key>Minute</key><integer>0</integer>' \
  '  </dict>' \
  '  <key>RunAtLoad</key><false/>' \
  "  <key>StandardOutPath</key><string>$escaped_log/backup.log</string>" \
  "  <key>StandardErrorPath</key><string>$escaped_log/backup-error.log</string>" \
  '</dict>' \
  '</plist>' > "$tmp_plist"

plutil -lint "$tmp_plist" >/dev/null
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
mv "$tmp_plist" "$PLIST"
trap - EXIT
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Installed $LABEL; ZYSYR will be backed up every day at 02:00."
