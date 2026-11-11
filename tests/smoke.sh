#!/bin/sh
set -eu

base_url="${BASE_URL:-http://127.0.0.1}"

login_page="$(curl -fsS "$base_url/login")"
printf '%s' "$login_page" | grep -q '<title>Sign in | Osiris</title>'
printf '%s' "$login_page" | grep -q 'Continue with Google'
printf '%s' "$login_page" | grep -q 'Create an account'

homepage_status="$(curl -sS -o /dev/null -w '%{http_code}' "$base_url/")"
test "$homepage_status" = "302"

auth_status="$(curl -sS -o /dev/null -w '%{http_code}' "$base_url/api/auth/me")"
test "$auth_status" = "401"

printf 'Authentication smoke tests passed.\n'