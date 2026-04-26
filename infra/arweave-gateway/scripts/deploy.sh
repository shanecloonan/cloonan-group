#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# First-time deploy / subsequent pulls for the self-hosted ar.io gateway.
#
# Idempotent. Safe to re-run.
# -----------------------------------------------------------------------------

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "ERROR: .env missing. Copy .env.example -> .env and fill it in first."
  exit 1
fi

command -v docker >/dev/null || { echo "Docker is required"; exit 1; }

# Prefer `docker compose` (v2) but fall back to `docker-compose`.
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
else
  DC="docker-compose"
fi

echo "== Pulling latest images =="
$DC pull

echo "== Bringing stack up =="
$DC up -d

echo
echo "== Container status =="
$DC ps

echo
echo "Give the node 60-90s to start, then run:"
echo "  ./scripts/healthcheck.sh"
