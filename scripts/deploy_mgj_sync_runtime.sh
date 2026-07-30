#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET_DIR="$HOME/.hermes/scripts"

mkdir -p "$TARGET_DIR"
cp "$SCRIPT_DIR/sync_mgj_customer_profiles.py" "$TARGET_DIR/sync_mgj_all.py"
cp "$SCRIPT_DIR/sync_mgj_bookings.py" "$TARGET_DIR/sync_mgj_bookings.py"
cp "$SCRIPT_DIR/sync_mgj_bookings.sh" "$TARGET_DIR/sync_bookings_wrapper.sh"
cp "$SCRIPT_DIR/backfill_mgj_customer_profiles.sh" "$TARGET_DIR/backfill_loop.sh"
cp "$SCRIPT_DIR/refresh_mgj_service_records.sh" "$TARGET_DIR/refresh_mgj_service_records.sh"
cp "$SCRIPT_DIR/check_mgj_sync_health.py" "$TARGET_DIR/check_mgj_sync_health.py"
cp "$SCRIPT_DIR/mgj_sync_health_watch.sh" "$TARGET_DIR/mgj_sync_health_watch.sh"

chmod 700 \
  "$TARGET_DIR/sync_mgj_all.py" \
  "$TARGET_DIR/sync_mgj_bookings.py" \
  "$TARGET_DIR/sync_bookings_wrapper.sh" \
  "$TARGET_DIR/backfill_loop.sh" \
  "$TARGET_DIR/refresh_mgj_service_records.sh" \
  "$TARGET_DIR/check_mgj_sync_health.py" \
  "$TARGET_DIR/mgj_sync_health_watch.sh"

verify_pair() {
  source_hash=$(shasum -a 256 "$1" | awk '{print $1}')
  target_hash=$(shasum -a 256 "$2" | awk '{print $1}')
  if [ "$source_hash" != "$target_hash" ]; then
    echo "美管加同步运行文件校验失败: $2" >&2
    exit 1
  fi
}

verify_pair "$SCRIPT_DIR/sync_mgj_customer_profiles.py" "$TARGET_DIR/sync_mgj_all.py"
verify_pair "$SCRIPT_DIR/sync_mgj_bookings.py" "$TARGET_DIR/sync_mgj_bookings.py"
verify_pair "$SCRIPT_DIR/sync_mgj_bookings.sh" "$TARGET_DIR/sync_bookings_wrapper.sh"
verify_pair "$SCRIPT_DIR/backfill_mgj_customer_profiles.sh" "$TARGET_DIR/backfill_loop.sh"
verify_pair "$SCRIPT_DIR/refresh_mgj_service_records.sh" "$TARGET_DIR/refresh_mgj_service_records.sh"
verify_pair "$SCRIPT_DIR/check_mgj_sync_health.py" "$TARGET_DIR/check_mgj_sync_health.py"
verify_pair "$SCRIPT_DIR/mgj_sync_health_watch.sh" "$TARGET_DIR/mgj_sync_health_watch.sh"

echo "美管加客户、预约、近期消费明细与健康巡检运行文件已部署"
