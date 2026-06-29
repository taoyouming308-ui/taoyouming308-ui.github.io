#!/bin/sh
set -eu

STATUS_FILE="/Users/a1/.hermes/mgj_customer_backfill.json"
if [ -f "$STATUS_FILE" ]; then
  COMPLETE=$(/usr/bin/python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get("cycle_complete", False))' "$STATUS_FILE")
  if [ "$COMPLETE" = "True" ]; then
    echo "客户消费/套餐回填已完成"
    exit 0
  fi
fi

exec /usr/bin/python3 /Users/a1/.hermes/scripts/sync_mgj_all.py backfill 50
