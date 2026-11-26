#!/usr/bin/env bash
# Runs every Osiris test in Docker containers. The same script runs on
# GitHub for every pull request (.github/workflows/test.yml) and on your own
# computer (needs Docker; on Windows run it from Git Bash):
#
#   bash tests/run_all.sh
#
# What it checks:
#  1. JavaScript: every script on the site compiles, and the streak, freeze
#     and reward math and the routine rhythms give the right answers
#     (Node). Lua: luacheck finds undefined and unused names in the server
#     code.
#  2. Database: all migrations run with the real db/migrate.sh (PostgreSQL 16).
#  3. Server: the real Lua code runs in OpenResty against that database, and
#     tests/api/api_test.sh calls the API like the browser does.
#  4. Reminders: the server's Lua sender (lua/osiris/push_sender.lua) sends
#     to a fake push service, and the test checks the signature and
#     decrypts the message with an independent library (Python, only in
#     this test container; the real server needs no Python).
# Everything runs in throwaway containers that are removed at the end.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Docker on Windows wants E:/path instead of Git Bash's /e/path.
if ROOT_FOR_DOCKER="$(cd "$ROOT" && pwd -W 2>/dev/null)"; then
    export MSYS_NO_PATHCONV=1
else
    ROOT_FOR_DOCKER="$ROOT"
fi

RUN_ID="osiris-test-$$"
NETWORK="$RUN_ID-net"
DB="$RUN_ID-db"
WEB="$RUN_ID-web"
PUSH="$RUN_ID-push"
PG_ENV=(-e PGHOST="$DB" -e PGPORT=5432 -e PGUSER=postgres -e PGPASSWORD=test -e PGDATABASE=osiris)

cleanup() {
    docker rm -f -v "$DB" "$WEB" "$PUSH" >/dev/null 2>&1 || true
    docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

step() {
    printf '\n=== %s\n' "$1"
}

step "1/4 JavaScript and Lua checks"
docker run --rm -v "$ROOT_FOR_DOCKER:/repo:ro" node:22-alpine sh -c '
    node --experimental-vm-modules --no-warnings /repo/tests/unit/syntax_check.mjs &&
    node /repo/tests/unit/streak_test.mjs &&
    node /repo/tests/unit/topaz_test.mjs &&
    node /repo/tests/unit/routines_test.mjs'
# luacheck finds names that are used but never defined (for example a
# function a module forgot to borrow from another module) and leftovers
# that are never used, before the server ever runs.
docker run --rm -v "$ROOT_FOR_DOCKER:/repo:ro" openresty/openresty:alpine-fat sh -c '
    luarocks install luacheck >/dev/null 2>&1 &&
    cd /repo/lua &&
    luacheck auth.lua security_headers.lua osiris/*.lua --std ngx_lua --codes --no-color --no-max-line-length --only 1 2 -q'

step "2/4 Database migrations"
docker network create "$NETWORK" >/dev/null
# "trust" lets the test server connect without a password exchange; this
# database only lives for the length of the test run.
docker run -d --name "$DB" --network "$NETWORK" \
    -e POSTGRES_PASSWORD=test -e POSTGRES_DB=osiris -e POSTGRES_HOST_AUTH_METHOD=trust \
    postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do
    if docker exec "$DB" pg_isready -U postgres -d osiris -h 127.0.0.1 >/dev/null 2>&1; then
        break
    fi
    sleep 1
done
docker run --rm --network "$NETWORK" "${PG_ENV[@]}" -v "$ROOT_FOR_DOCKER:/repo:ro" postgres:16 \
    bash /repo/db/migrate.sh

step "3/4 Server API"
# The reminder key pair is made the same way deploy.sh makes it, and the
# public half copied where the site reads it, so reminders are offered.
docker run -d --name "$WEB" --network "$NETWORK" "${PG_ENV[@]}" -v "$ROOT_FOR_DOCKER:/src:ro" \
    openresty/openresty:alpine-fat sh -c '
        apk add -q --no-cache curl jq postgresql-client openssl >/dev/null &&
        opm get leafo/pgmoon >/dev/null 2>&1 &&
        cp -r /src /opt/mysite &&
        sh /opt/mysite/reminders/make_vapid_keys.sh /etc/mysite >/dev/null &&
        cp /etc/mysite/vapid_public.txt /opt/mysite/lua/vapid_public_key.txt &&
        mkdir -p /tmp/logs &&
        exec openresty -p /tmp/ -c /opt/mysite/tests/api/nginx.conf -g "daemon off; pid /tmp/nginx.pid;"' >/dev/null
for _ in $(seq 1 90); do
    if docker exec "$WEB" sh -c 'command -v curl >/dev/null && curl -s -o /dev/null http://127.0.0.1:8080/welcome' 2>/dev/null; then
        break
    fi
    sleep 1
done
if ! docker exec "$WEB" sh -c 'sh /opt/mysite/tests/api/api_test.sh && sh /opt/mysite/tests/api/routines_test.sh'; then
    echo "--- server log:"
    docker logs "$WEB" 2>&1 | tail -30
    exit 1
fi
server_errors="$(docker logs "$WEB" 2>&1 | grep -E '\[(error|crit|alert)\]' | grep -v 'groq-chat' || true)"
if [[ -n "$server_errors" ]]; then
    echo "The server logged errors during the API tests:"
    echo "$server_errors"
    exit 1
fi

step "4/4 Reminder sender"
if ! docker run --rm --name "$PUSH" --network "$NETWORK" "${PG_ENV[@]}" \
    -e WEB_URL="http://$WEB:8080" -e PUSH_HOST="$PUSH" -v "$ROOT_FOR_DOCKER:/repo:ro" python:3.12-slim sh -c '
    pip install -q --root-user-action=ignore --disable-pip-version-check \
        "psycopg[binary]==3.2.3" http_ece cryptography &&
    python /repo/tests/reminders/reminder_test.py'; then
    echo "--- server log:"
    docker logs "$WEB" 2>&1 | grep -E '\[(warn|error|crit|alert|notice)\]' | tail -30
    exit 1
fi

printf '\nAll tests passed.\n'
