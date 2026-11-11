#!/bin/sh
set -eu

base_url="${BASE_URL:-http://127.0.0.1}"

homepage="$(curl -fsS "$base_url/")"
printf '%s' "$homepage" | grep -q '<title>Osiris</title>'
printf '%s' "$homepage" | grep -q '<h1 id="groq-title">Groq AI demo</h1>'
printf '%s' "$homepage" | grep -q '<nav class="launcher-actions" id="launcher-actions" aria-label="Quick access"></nav>'
printf '%s' "$homepage" | grep -q 'label: "Open settings"'
printf '%s' "$homepage" | grep -q 'label: "Open Groq AI test"'
if printf '%s' "$homepage" | grep -q 'menu-launcher'; then
  printf 'The old menu launcher should not be present.\n' >&2
  exit 1
fi

printf 'Smoke tests passed.\n'