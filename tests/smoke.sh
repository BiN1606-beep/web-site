#!/bin/sh
set -eu

base_url="${BASE_URL:-http://127.0.0.1}"

homepage="$(curl -fsS "$base_url/")"
printf '%s' "$homepage" | grep -q '<title>Shared text</title>'
printf '%s' "$homepage" | grep -q '<h1 id="groq-title">Groq AI demo</h1>'

printf 'Smoke tests passed.\n'