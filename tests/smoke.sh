#!/bin/sh
set -eu

base_url="${BASE_URL:-http://127.0.0.1}"

login_page="$(curl -fsS "$base_url/login")"
printf '%s' "$login_page" | grep -q '<title>Sign in | Osiris</title>'
printf '%s' "$login_page" | grep -q 'Continue with Google'
printf '%s' "$login_page" | grep -q 'google-config'
printf '%s' "$login_page" | grep -q 'Google sign-in is not configured yet'
printf '%s' "$login_page" | grep -q 'Create an account'
printf '%s' "$login_page" | grep -q 'Remember me for 6 months'

homepage_status="$(curl -sS -o /dev/null -w '%{http_code}' "$base_url/")"
test "$homepage_status" = "302"

auth_status="$(curl -sS -o /dev/null -w '%{http_code}' "$base_url/api/auth/me")"
test "$auth_status" = "401"

profile_status="$(curl -sS -o /dev/null -w '%{http_code}' "$base_url/api/auth/profile")"
test "$profile_status" = "401"

progress_tree_status="$(curl -sS -o /dev/null -w '%{http_code}' "$base_url/api/progress-tree")"
test "$progress_tree_status" = "401"

community_status="$(curl -sS -o /dev/null -w '%{http_code}' "$base_url/api/community")"
test "$community_status" = "401"

printf 'Authentication smoke tests passed.\n'