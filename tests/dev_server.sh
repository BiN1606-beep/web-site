#!/usr/bin/env bash
# Runs Osiris on your own computer at http://localhost:8080, with a fresh
# empty database, so you can click around and try changes before they go
# live. Needs Docker; on Windows run it from Git Bash.
#
#   bash tests/dev_server.sh        start (sign up with any test email)
#   bash tests/dev_server.sh stop   stop and delete the test database
#
# The site files are read straight from this folder, so after changing
# HTML, CSS or JavaScript just reload the page. After changing Lua code or
# nginx settings, stop and start again. The AI coach, Google sign-in and
# reminders are not connected here.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if ROOT_FOR_DOCKER="$(cd "$ROOT" && pwd -W 2>/dev/null)"; then
    export MSYS_NO_PATHCONV=1
else
    ROOT_FOR_DOCKER="$ROOT"
fi

NETWORK="osiris-dev-net"
DB="osiris-dev-db"
WEB="osiris-dev-web"
PG_ENV=(-e PGHOST="$DB" -e PGPORT=5432 -e PGUSER=postgres -e PGPASSWORD=dev -e PGDATABASE=osiris)

stop() {
    docker rm -f -v "$DB" "$WEB" >/dev/null 2>&1 || true
    docker network rm "$NETWORK" >/dev/null 2>&1 || true
}

if [[ "${1:-}" == "stop" ]]; then
    stop
    echo "Stopped."
    exit 0
fi

stop
docker network create "$NETWORK" >/dev/null
docker run -d --name "$DB" --network "$NETWORK" \
    -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=osiris -e POSTGRES_HOST_AUTH_METHOD=trust \
    postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do
    docker exec "$DB" pg_isready -U postgres -d osiris -h 127.0.0.1 >/dev/null 2>&1 && break
    sleep 1
done
docker run --rm --network "$NETWORK" "${PG_ENV[@]}" -v "$ROOT_FOR_DOCKER:/repo:ro" postgres:16 \
    bash /repo/db/migrate.sh >/dev/null

docker run -d --name "$WEB" --network "$NETWORK" -p 127.0.0.1:8080:8080 "${PG_ENV[@]}" \
    -v "$ROOT_FOR_DOCKER:/opt/mysite:ro" openresty/openresty:alpine-fat sh -c '
        opm get leafo/pgmoon >/dev/null 2>&1 &&
        mkdir -p /tmp/logs &&
        exec openresty -p /tmp/ -c /opt/mysite/tests/api/nginx.conf -g "daemon off; pid /tmp/nginx.pid;"' >/dev/null
for _ in $(seq 1 90); do
    curl -s -o /dev/null http://127.0.0.1:8080/welcome 2>/dev/null && break
    sleep 1
done
echo "Osiris is running at http://localhost:8080"
echo "Server log: docker logs -f $WEB    Stop: bash tests/dev_server.sh stop"
