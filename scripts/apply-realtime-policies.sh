#!/usr/bin/env bash
# realtime.messages is owned by supabase_realtime_admin. Local migrations run
# as postgres, which cannot create policies on that table. Apply them on the
# local socket as supabase_admin (trust auth inside the database container).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cid="$(docker ps -qf name=supabase_db_)"
if [[ -z "$cid" ]]; then
  echo "Local Supabase database container is not running." >&2
  exit 1
fi
docker exec -i "$cid" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < "$root/supabase/realtime_authorization.sql"
echo "Realtime authorization policies applied."
