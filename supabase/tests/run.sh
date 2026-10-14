#!/usr/bin/env bash
# Spin up a throwaway Postgres, apply the Supabase shim + migrations, run RLS tests.
set -euo pipefail
cd "$(dirname "$0")/../.."

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DATA="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
trap '"$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"' EXIT

run() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$DATA"

run "$PGBIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
run "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $DATA -c listen_addresses=''" -w start >/dev/null

PSQL=(psql -h "$DATA" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -c 'create database app'
"${PSQL[@]}" -d app -f supabase/tests/supabase_shim.sql
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -d app -f "$f"; done
"${PSQL[@]}" -d app -o /dev/null -f supabase/tests/rls_test.sql 2>&1 | sed -E "s/^psql:[^ ]+ NOTICE:  //"
