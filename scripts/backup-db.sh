#!/usr/bin/env bash
# Logical backup of the Supabase database, reported to /api/ops/backup-result so
# a missing or failed backup raises an alert. Needs pg_dump 15+.
#
#   SUPABASE_DB_URL  postgres connection string (Settings > Database)
#   APP_URL          deployed app origin, e.g. https://pos.example.com
#   OPS_API_TOKEN    same token the app uses
#   BACKUP_DIR       optional, default ./backups
set -euo pipefail
: "${SUPABASE_DB_URL:?}" "${APP_URL:?}" "${OPS_API_TOKEN:?}"
dir="${BACKUP_DIR:-./backups}"; mkdir -p "$dir"
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
file="$dir/pos-$(date -u +%Y%m%dT%H%M%SZ).dump"

report() { # status, size, detail
  curl -fsS -X POST "$APP_URL/api/ops/backup-result" \
    -H "Authorization: Bearer $OPS_API_TOKEN" -H "Content-Type: application/json" \
    -d "{\"status\":\"$1\",\"sizeBytes\":$2,\"location\":\"$(basename "$file")\",\"detail\":\"$3\",\"startedAt\":\"$started\"}" >/dev/null || echo "could not report backup result" >&2
}

if pg_dump --format=custom --no-owner --schema=public --file="$file" "$SUPABASE_DB_URL"; then
  size="$(wc -c < "$file" | tr -d ' ')"
  report ok "$size" "pg_dump custom format"
  echo "backup ok: $file ($size bytes)"
else
  rm -f "$file"
  report failed 0 "pg_dump failed"
  echo "backup FAILED" >&2
  exit 1
fi
