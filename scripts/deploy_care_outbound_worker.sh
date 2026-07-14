#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET_DIR="$HOME/.hermes/scripts"

mkdir -p "$TARGET_DIR"
cp "$SCRIPT_DIR/care_outbound_worker.py" "$TARGET_DIR/care_outbound_worker.py"
cp "$SCRIPT_DIR/care_outbound_store_config.json" "$TARGET_DIR/care_outbound_store_config.json"
cp "$SCRIPT_DIR/mgj_keepalive.py" "$TARGET_DIR/mgj_keepalive.py"
chmod 700 "$TARGET_DIR/care_outbound_worker.py"
chmod 700 "$TARGET_DIR/mgj_keepalive.py"
chmod 600 "$TARGET_DIR/care_outbound_store_config.json"

SOURCE_WORKER=$(shasum -a 256 "$SCRIPT_DIR/care_outbound_worker.py" | awk '{print $1}')
TARGET_WORKER=$(shasum -a 256 "$TARGET_DIR/care_outbound_worker.py" | awk '{print $1}')
SOURCE_CONFIG=$(shasum -a 256 "$SCRIPT_DIR/care_outbound_store_config.json" | awk '{print $1}')
TARGET_CONFIG=$(shasum -a 256 "$TARGET_DIR/care_outbound_store_config.json" | awk '{print $1}')
SOURCE_KEEPALIVE=$(shasum -a 256 "$SCRIPT_DIR/mgj_keepalive.py" | awk '{print $1}')
TARGET_KEEPALIVE=$(shasum -a 256 "$TARGET_DIR/mgj_keepalive.py" | awk '{print $1}')

if [ "$SOURCE_WORKER" != "$TARGET_WORKER" ] || [ "$SOURCE_CONFIG" != "$TARGET_CONFIG" ] || [ "$SOURCE_KEEPALIVE" != "$TARGET_KEEPALIVE" ]; then
  echo "护理出库执行器部署校验失败" >&2
  exit 1
fi

echo "护理出库执行器、门店配置与独立会话保活已部署"
