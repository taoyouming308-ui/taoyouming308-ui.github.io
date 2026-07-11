#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$PROJECT_ROOT/backups/daily"
CONFIG_FILE="$PROJECT_ROOT/scripts/backup.env"
PROJECT_NAME="ZYSYR"
RETENTION_DAYS=30
FORCE=0

if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--force]" >&2
  exit 64
fi

if [[ -f "$CONFIG_FILE" ]]; then
  # This file is local-only. Keep it limited to trusted KEY=value settings.
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

mkdir -p "$BACKUP_DIR"
TODAY="$(date +%F)"

if [[ "$FORCE" -eq 0 ]] && find "$BACKUP_DIR" -maxdepth 1 -type f -name "${PROJECT_NAME}_${TODAY}_*.tar.gz" -print -quit | grep -q .; then
  echo "A ZYSYR backup already exists for $TODAY; no new archive was created."
  exit 0
fi

TIMESTAMP="$(date +%F_%H%M%S)"
ARCHIVE_NAME="${PROJECT_NAME}_${TIMESTAMP}.tar.gz"
TEMP_ARCHIVE="$BACKUP_DIR/.${ARCHIVE_NAME}.tmp"
FINAL_ARCHIVE="$BACKUP_DIR/$ARCHIVE_NAME"

cleanup() {
  rm -f "$TEMP_ARCHIVE"
}
trap cleanup EXIT INT TERM

tar -czf "$TEMP_ARCHIVE" \
  --exclude='./.git' \
  --exclude='./backups' \
  --exclude='./node_modules' \
  --exclude='./.DS_Store' \
  --exclude='./supabase/.temp' \
  --exclude='./scripts/backup.env' \
  --exclude='*/__pycache__' \
  --exclude='*.pyc' \
  -C "$PROJECT_ROOT" .

tar -tzf "$TEMP_ARCHIVE" >/dev/null
mv "$TEMP_ARCHIVE" "$FINAL_ARCHIVE"
trap - EXIT INT TERM

find "$BACKUP_DIR" -maxdepth 1 -type f -name "${PROJECT_NAME}_*.tar.gz" -mtime "+$RETENTION_DAYS" -delete

if [[ -n "${ICLOUD_BACKUP_DIR:-}" ]]; then
  mkdir -p "$ICLOUD_BACKUP_DIR/daily"
  cp -p "$FINAL_ARCHIVE" "$ICLOUD_BACKUP_DIR/daily/$ARCHIVE_NAME"
  find "$ICLOUD_BACKUP_DIR/daily" -maxdepth 1 -type f -name "${PROJECT_NAME}_*.tar.gz" -mtime "+$RETENTION_DAYS" -delete
  echo "Backup created and copied to iCloud: $ARCHIVE_NAME"
else
  echo "Local backup created: $FINAL_ARCHIVE"
fi
