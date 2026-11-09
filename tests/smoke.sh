#!/bin/sh
set -eu

base_url="${BASE_URL:-http://127.0.0.1}"

homepage="$(curl -fsS "$base_url/")"
printf '%s' "$homepage" | grep -q '<title>Shared text</title>'

printf 'Smoke tests passed.\n'