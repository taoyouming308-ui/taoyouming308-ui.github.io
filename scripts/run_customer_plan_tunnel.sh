#!/bin/sh
set -eu

LOG_PATH="${CUSTOMER_PLAN_TUNNEL_LOG:-/Users/a1/.hermes/logs/customer-plan-tunnel.log}"
mkdir -p "$(dirname "$LOG_PATH")"

exec /opt/homebrew/bin/cloudflared tunnel --protocol http2 --url http://127.0.0.1:8890 >>"$LOG_PATH" 2>&1
