#!/usr/bin/env bash
set -euo pipefail

mkdir -p backups
container_id="$(docker compose ps -q monitor)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
docker cp "${container_id}:/data/monitor.sqlite3" "backups/monitor-${timestamp}.sqlite3"
