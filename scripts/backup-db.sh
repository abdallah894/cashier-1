#!/usr/bin/env bash
# Encrypted, off-site logical backup of the Supabase database, reported to
# /api/ops/backup-result so a missing or failed backup raises an alert.
# Needs pg_dump 15+ and either `age` or `gpg`.
#
# Two dumps per run, because staff cannot sign in without their auth rows
# (public.profiles.id references auth.users):
#   pos-<ts>.dump       schema + data of the public schema
#   pos-<ts>-auth.dump  DATA ONLY of auth.users and auth.identities
# Restore order (see docs/operations/runbook.md): auth first, then public.
#
#   SUPABASE_DB_URL        postgres connection string (Settings > Database)
#   APP_URL                deployed app origin, e.g. https://pos.example.com
#   OPS_API_TOKEN          same token the app uses
#   BACKUP_DIR             optional, default ./backups
#   BACKUP_AGE_RECIPIENT   age public key (age1...) to encrypt for   } one of these,
#   BACKUP_GPG_RECIPIENT   gpg key id / email to encrypt for         } unless the next
#   BACKUP_ALLOW_UNENCRYPTED=1  only for a local test; never in production
#   BACKUP_UPLOAD_CMD      command run once per file with the path as $1, e.g.
#                            'rclone copyto "$1" remote:pos-backups/$(basename "$1")'
#                            'aws s3 cp "$1" s3://my-bucket/pos/'
#                          Required: a backup that only lives on this disk is not a backup.
#   BACKUP_KEEP_LOCAL=1    keep the local copies after a successful upload
set -euo pipefail
: "${SUPABASE_DB_URL:?}" "${APP_URL:?}" "${OPS_API_TOKEN:?}"
dir="${BACKUP_DIR:-./backups}"; mkdir -p "$dir"
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
public_file="$dir/pos-$stamp.dump"
auth_file="$dir/pos-$stamp-auth.dump"
label="pos-$stamp"
files=()

report() { # status, size, detail
  curl -fsS -X POST "$APP_URL/api/ops/backup-result" \
    -H "Authorization: Bearer $OPS_API_TOKEN" -H "Content-Type: application/json" \
    -d "{\"status\":\"$1\",\"sizeBytes\":$2,\"location\":\"$label\",\"detail\":\"$3\",\"startedAt\":\"$started\"}" >/dev/null || echo "could not report backup result" >&2
}
fail() { # detail
  rm -f "$public_file" "$auth_file" ${files[@]+"${files[@]}"} 2>/dev/null || true
  report failed 0 "$1"
  echo "backup FAILED: $1" >&2
  exit 1
}

# Refuse to run in a configuration that cannot protect or keep the data.
if [ -z "${BACKUP_AGE_RECIPIENT:-}" ] && [ -z "${BACKUP_GPG_RECIPIENT:-}" ] && [ "${BACKUP_ALLOW_UNENCRYPTED:-}" != "1" ]; then
  fail "no encryption configured (set BACKUP_AGE_RECIPIENT or BACKUP_GPG_RECIPIENT)"
fi
if [ -z "${BACKUP_UPLOAD_CMD:-}" ]; then
  fail "no off-site upload configured (set BACKUP_UPLOAD_CMD)"
fi

pg_dump --format=custom --no-owner --schema=public --file="$public_file" "$SUPABASE_DB_URL" || fail "pg_dump public failed"
pg_dump --format=custom --no-owner --data-only --table=auth.users --table=auth.identities --file="$auth_file" "$SUPABASE_DB_URL" || fail "pg_dump auth failed"

encrypt() { # in -> prints the path of the file to keep
  local in="$1"
  if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
    age -r "$BACKUP_AGE_RECIPIENT" -o "$in.age" "$in" && rm -f "$in" && echo "$in.age"
  elif [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
    gpg --batch --yes --trust-model always --recipient "$BACKUP_GPG_RECIPIENT" --output "$in.gpg" --encrypt "$in" && rm -f "$in" && echo "$in.gpg"
  else
    echo "$in"
  fi
}
public_out="$(encrypt "$public_file")" || fail "encryption failed"
files+=("$public_out")
auth_out="$(encrypt "$auth_file")" || fail "encryption failed"
files+=("$auth_out")

size=0
for f in "${files[@]}"; do
  size=$((size + $(wc -c < "$f" | tr -d ' ')))
  # shellcheck disable=SC2016
  bash -c "$BACKUP_UPLOAD_CMD" _ "$f" || fail "off-site upload failed"
done

if [ "${BACKUP_KEEP_LOCAL:-}" != "1" ]; then rm -f "${files[@]}"; fi
report ok "$size" "public + auth dumps, encrypted, uploaded off-site"
echo "backup ok: $label ($size bytes, ${#files[@]} files)"
