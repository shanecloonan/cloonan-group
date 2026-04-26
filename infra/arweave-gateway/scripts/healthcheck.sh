#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Health check — call from cron / systemd timer / external monitor.
#
# Exits non-zero if:
#   - /ar-io/info is unreachable
#   - node is more than $MAX_LAG_BLOCKS behind the trusted upstream
#
# Usage:
#   ./healthcheck.sh                        # local, against docker
#   GATEWAY_URL=https://gateway.example.com MAX_LAG_BLOCKS=50 ./healthcheck.sh
# -----------------------------------------------------------------------------

set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:-http://localhost:3000}"
UPSTREAM_URL="${UPSTREAM_URL:-https://arweave.net}"
MAX_LAG_BLOCKS="${MAX_LAG_BLOCKS:-100}"

jget() { jq -r "$1" 2>/dev/null || echo ""; }

echo "== Arweave Gateway Healthcheck =="
echo "Gateway:  $GATEWAY_URL"
echo "Upstream: $UPSTREAM_URL"
echo

# --- 1. Gateway /ar-io/info ---------------------------------------------------
info_json="$(curl --max-time 10 -sSf "$GATEWAY_URL/ar-io/info" || true)"
if [[ -z "$info_json" ]]; then
  echo "FAIL: gateway /ar-io/info unreachable"
  exit 2
fi

node_height="$(echo "$info_json" | jget '.blockHeight // .height // 0')"
node_release="$(echo "$info_json" | jget '.release // "?"')"
echo "Node height:  $node_height (release $node_release)"

# --- 2. Upstream network height ----------------------------------------------
up_info="$(curl --max-time 10 -sSf "$UPSTREAM_URL/info" || true)"
if [[ -z "$up_info" ]]; then
  echo "WARN: upstream $UPSTREAM_URL unreachable (skipping lag check)"
  exit 0
fi

net_height="$(echo "$up_info" | jget '.height // 0')"
echo "Network height: $net_height"

if [[ "$node_height" -eq 0 || "$net_height" -eq 0 ]]; then
  echo "FAIL: could not parse heights"
  exit 3
fi

lag=$((net_height - node_height))
echo "Sync lag:       $lag block(s)"

if [[ "$lag" -gt "$MAX_LAG_BLOCKS" ]]; then
  echo "FAIL: lag $lag exceeds MAX_LAG_BLOCKS=$MAX_LAG_BLOCKS"
  exit 4
fi

echo "OK"
