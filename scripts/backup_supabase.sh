#!/usr/bin/env bash
# Read source only. Never restores, links, migrates or changes the database.
set +x
set -euo pipefail
umask 077
migration_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -z "${SOURCE_DB_URL:-}" ]]; then
  echo 'SOURCE_DB_URL is missing. For Lovable Cloud, use its explicitly authorized full database export instead.' >&2
  exit 2
fi
for migration_tool in supabase psql; do
  if ! command -v "$migration_tool" >/dev/null 2>&1; then
    echo "Required client not installed: $migration_tool" >&2
    exit 2
  fi
done
migration_date="$(date '+%Y-%m-%dT%H%M%S%z')"
migration_backup="$migration_root/backups/$migration_date"
mkdir -p "$migration_backup"
chmod 700 "$migration_backup"
migration_log="$migration_backup/private-client.log"
# Keep connection strings and raw client errors out of terminal/chat output.
if ! supabase db dump --db-url "$SOURCE_DB_URL" --schema public,auth,storage --file "$migration_backup/schema.sql" >"$migration_log" 2>&1; then
  echo 'Schema export failed. Inspect private-client.log locally; no restore was attempted.' >&2; exit 1
fi
if ! supabase db dump --db-url "$SOURCE_DB_URL" --schema public,auth,storage --data-only --use-copy --file "$migration_backup/data.sql" >>"$migration_log" 2>&1; then
  echo 'Data export failed. No restore was attempted.' >&2; exit 1
fi
if ! supabase db dump --db-url "$SOURCE_DB_URL" --role-only --file "$migration_backup/roles.sql" >>"$migration_log" 2>&1; then
  echo 'Role export failed. No restore was attempted.' >&2; exit 1
fi
if ! PGOPTIONS='-c default_transaction_read_only=on' psql --no-psqlrc --dbname "$SOURCE_DB_URL" --set ON_ERROR_STOP=1 --tuples-only --no-align --file "$migration_root/scripts/migration_inventory.sql" >"$migration_backup/source-inventory.json" 2>>"$migration_log"; then
  echo 'Read-only inventory failed. Backup is not marked complete.' >&2; exit 1
fi
python3 - "$migration_backup" <<'CHECK'
from pathlib import Path
import sys,re,json,hashlib
p=Path(sys.argv[1]);data=(p/'data.sql').read_text()
# A public-only dump must never masquerade as a complete account backup.
if not re.search(r'(?:COPY|INSERT INTO)\s+(?:"auth"|auth)\.(?:"users"|users)\b',data,re.I):
    raise SystemExit('Auth users data was not found. Backup incomplete; use the full native Cloud export.')
for n in ['schema.sql','data.sql','roles.sql','source-inventory.json']:
    if not (p/n).is_file() or not (p/n).stat().st_size:raise SystemExit('Backup file missing or empty: '+n)
json.loads((p/'source-inventory.json').read_text())
manifest={n:{'bytes':(p/n).stat().st_size,'sha256':hashlib.sha256((p/n).read_bytes()).hexdigest()} for n in ['schema.sql','data.sql','roles.sql','source-inventory.json']}
(p/'checksums.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Read-only database exports completed; file checksums recorded. No restore performed.')
CHECK
