#!/bin/sh
set -eu

base_url="${BASE_URL:-http://127.0.0.1:8080}"

homepage="$(curl -fsS "$base_url/")"
printf '%s' "$homepage" | grep -q '<title>OpenResty Starter</title>'

health="$(curl -fsS "$base_url/health")"
[ "$health" = '{"status":"ok"}' ]

printf 'Smoke tests passed.\n'