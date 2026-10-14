#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" && -f .env ]]; then
  DATABASE_URL="$(node --env-file-if-exists=.env -p 'process.env.DATABASE_URL ?? ""')"
  export DATABASE_URL
fi

: "${DATABASE_URL:?DATABASE_URL must be set before backing up PostgreSQL.}"
command -v pg_dump >/dev/null 2>&1 || {
  echo "pg_dump is required to create a database backup." >&2
  exit 1
}

backup_dir="${DB_BACKUP_DIR:-generated-artifacts/database-backups}"
mkdir -p "$backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$backup_dir/wa-campaign-${timestamp}.dump"

pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" --file "$backup_file"
chmod 600 "$backup_file"
printf 'Database backup created: %s\n' "$backup_file"
