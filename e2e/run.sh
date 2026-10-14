#!/usr/bin/env bash
# End-to-end check of the admin UI against real Postgres + PostgREST (Supabase's REST layer).
# Needs: Postgres 16 binaries (PGBIN), Docker, Playwright Chromium (npx playwright install chromium).
set -euo pipefail
cd "$(dirname "$0")/.."

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)}"
[ -x "${PGBIN:-}/initdb" ] || { echo "e2e: Postgres binaries not found; set PGBIN" >&2; exit 1; }
PGPORT=54339; API=54321; REST=54322; WEB=4180
DATA="$(mktemp -d)"; OUT="${E2E_OUT:-$(mktemp -d)}"; mkdir -p "$OUT"
NAME="ilca-e2e-postgrest-$$"
SECRET="e2e-only-jwt-secret-at-least-32-characters-long"
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  [ -n "${PROXY:-}" ] && kill "$PROXY" 2>/dev/null || true
  [ -n "${WEBPID:-}" ] && kill "$WEBPID" 2>/dev/null || true
  "$PGBIN/pg_ctl" -D "$DATA/pg" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT

# A leftover server on one of our ports would make this run test a stale build: refuse instead.
for port in $PGPORT $API $REST $WEB; do
  if ss -ltn | grep -q ":$port "; then echo "e2e: port $port is already in use (leftover run?)" >&2; exit 1; fi
done

"$PGBIN/initdb" -D "$DATA/pg" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$DATA/pg" -o "-p $PGPORT -k $DATA -c listen_addresses=127.0.0.1" -w start >/dev/null
PSQL=(psql -h 127.0.0.1 -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -c 'create database app'
"${PSQL[@]}" -d app -f supabase/tests/supabase_shim.sql
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -d app -f "$f"; done
"${PSQL[@]}" -d app -f e2e/seed.sql

docker run -d --rm --name "$NAME" --network host \
  -e PGRST_DB_URI="postgres://authenticator@127.0.0.1:$PGPORT/app" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRET" \
  -e PGRST_SERVER_PORT="$REST" postgrest/postgrest:v12.2.12 >/dev/null
node e2e/proxy.mjs "$API" "http://127.0.0.1:$REST" & PROXY=$!

ANON=$(node e2e/jwt.mjs "$SECRET" anon)
VITE_SUPABASE_URL="http://127.0.0.1:$API" VITE_SUPABASE_ANON_KEY="$ANON" \
  node node_modules/vite/bin/vite.js build --outDir "$DATA/dist" --emptyOutDir >/dev/null
node node_modules/vite/bin/vite.js preview --outDir "$DATA/dist" --host 127.0.0.1 --port "$WEB" --strictPort >/dev/null 2>&1 & WEBPID=$!
ready() { curl -sf "http://127.0.0.1:$REST/" >/dev/null && curl -sf "http://127.0.0.1:$WEB/" >/dev/null; }
for _ in $(seq 100); do ready && break; sleep 0.2; done
ready || { echo "e2e: PostgREST or web server did not start" >&2; docker logs "$NAME" 2>&1 | tail -5 >&2; exit 1; }

node e2e/admin-flow.mjs "http://127.0.0.1:$WEB" "$SECRET" "$OUT"
echo "e2e screenshots: $OUT"
