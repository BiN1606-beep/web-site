#!/bin/sh
set -eu

base_url="${BASE_URL:-http://127.0.0.1}"

homepage="$(curl -fsS "$base_url/")"
printf '%s' "$homepage" | grep -q '<title>OpenResty Starter</title>'

printf 'Smoke tests passed.\n'