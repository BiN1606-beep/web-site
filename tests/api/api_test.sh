#!/bin/sh
set -eu
B=${BASE_URL:-http://127.0.0.1:8080}
J=/tmp/jar
TODAY=$(date -u +%F)
OLD=$(date -u -d "@$(( $(date +%s) - 5*86400 ))" +%F)
fail() { echo "FAIL: $*"; exit 1; }
post() { curl -sS -b $J -c $J -H 'Content-Type: application/json' -o /tmp/out -w '%{http_code}' -X POST "$B/api/progress-tree" -d "$1"; }

code=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' $B/); echo "GET / signed out: $code"; case "$code" in "302 "*/welcome) ;; *) fail "home redirect";; esac
code=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' $B/other.html); case "$code" in "302 "*/login) ;; *) fail "other redirect $code";; esac
[ "$(curl -sS -o /dev/null -w '%{http_code}' $B/welcome)" = 200 ] || fail welcome
[ "$(curl -sS -o /dev/null -w '%{http_code}' $B/sw.js)" = 200 ] || fail sw
[ "$(curl -sS -o /dev/null -w '%{http_code}' $B/icons/icon-192.png)" = 200 ] || fail icon
curl -sS -I $B/manifest.webmanifest | grep -qi 'content-type: application/manifest+json' || fail manifest
echo "public pages ok"

code=$(curl -sS -c $J -o /tmp/out -w '%{http_code}' -H 'Content-Type: application/json' -X POST $B/api/auth/signup -d '{"email":"t@test.se","password":"averylongpassword1"}')
[ "$code" = 201 ] || { cat /tmp/out; fail "signup $code"; }
psql -q -v ON_ERROR_STOP=1 -c "INSERT INTO user_progress_trees (user_id, tree_data, completed_count, is_active) SELECT id, '{\"goal\":\"G\",\"area\":\"Health\",\"summary\":\"s\",\"steps\":[{\"title\":\"s1\",\"description\":\"d\",\"why\":\"w\"},{\"title\":\"s2\",\"description\":\"d\",\"why\":\"w\",\"how\":[\"a\",\"b\"]},{\"title\":\"s3\",\"description\":\"d\",\"why\":\"w\"}]}', 0, true FROM auth_users WHERE email='t@test.se'"

curl -sS -b $J -o /tmp/out $B/api/progress-tree
jq -e '.reminders_key | startswith("BPLACEHOLDER")' /tmp/out >/dev/null || fail "reminders_key"
jq -e '.tree.exists and (.tree.checkins | length == 0)' /tmp/out >/dev/null || fail "initial tree"
echo "GET tree ok"

[ "$(post "{\"action\":\"checkin\",\"day\":\"$OLD\",\"note\":\"late\"}")" = 400 ] || fail "old day accepted"
[ "$(post "{\"action\":\"checkin\",\"day\":\"$TODAY\",\"note\":\"   \"}")" = 400 ] || fail "blank note accepted"
[ "$(post "{\"action\":\"checkin\",\"day\":\"2026-02-31\",\"note\":\"x\"}")" = 400 ] || fail "impossible date accepted"
[ "$(post "{\"action\":\"checkin\",\"day\":\"$TODAY\",\"note\":\"ran 2 km\"}")" = 200 ] || { cat /tmp/out; fail checkin; }
jq -e --arg d "$TODAY" '.tree.checkins[0] == {"day":$d,"note":"ran 2 km"}' /tmp/out >/dev/null || { cat /tmp/out; fail "checkin saved"; }
echo "checkin ok"

[ "$(post "{\"action\":\"complete\",\"expectedStep\":0,\"day\":\"$TODAY\"}")" = 200 ] || { cat /tmp/out; fail complete; }
jq -e '.tree.completed_count == 1 and (.tree.completed[0].completed_at | test("Z$")) and .tree.checkins[0].note == "ran 2 km"' /tmp/out >/dev/null || { cat /tmp/out; fail "complete payload"; }
echo "complete ok (date saved, own check-in kept)"

[ "$(post '{"action":"step_guide","expectedStep":1}')" = 200 ] || { cat /tmp/out; fail "guide cached"; }
jq -e '.tree.current_step.how == ["a","b"]' /tmp/out >/dev/null || fail "guide how"
echo "step guide (saved how-to) ok"

[ "$(post "{\"action\":\"undo_step\",\"expectedStep\":5,\"day\":\"$TODAY\"}")" = 409 ] || fail "stale undo"
[ "$(post "{\"action\":\"undo_step\",\"expectedStep\":1,\"day\":\"$TODAY\"}")" = 200 ] || { cat /tmp/out; fail undo; }
jq -e '.tree.completed_count == 0 and .tree.checkins[0].note == "ran 2 km"' /tmp/out >/dev/null || { cat /tmp/out; fail "undo payload"; }
[ "$(psql -tAc 'SELECT count(*) FROM step_completions')" = 0 ] || fail "undo date"
echo "undo ok"

[ "$(post '{"action":"step_guide","expectedStep":0}')" = 502 ] || { cat /tmp/out; fail "guide without AI should be 502/503"; }
echo "step guide without AI fails cleanly: $(jq -r .error /tmp/out)"

SUB='{"endpoint":"https://fcm.googleapis.com/fcm/send/abc","keys":{"p256dh":"BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM","auth":"tBHItJI5svbpez7KI4CCXg"}}'
[ "$(post "{\"action\":\"reminder_subscribe\",\"subscription\":$SUB,\"timezone\":\"Europe/Stockholm\",\"hour\":20}")" = 200 ] || { cat /tmp/out; fail subscribe; }
[ "$(post "{\"action\":\"reminder_subscribe\",\"subscription\":$SUB,\"timezone\":\"Nowhere/Land\",\"hour\":20}")" = 400 ] || fail "bad tz"
[ "$(post "{\"action\":\"reminder_subscribe\",\"subscription\":$SUB,\"timezone\":\"UTC\",\"hour\":24}")" = 400 ] || fail "bad hour"
EVIL='{"endpoint":"https://evil.example.com/fcm.googleapis.com/","keys":{"p256dh":"BNcR","auth":"tBHI"}}'
[ "$(post "{\"action\":\"reminder_subscribe\",\"subscription\":$EVIL,\"timezone\":\"UTC\",\"hour\":20}")" = 400 ] || fail "evil endpoint"
[ "$(psql -tAc "SELECT timezone || ' ' || remind_hour FROM push_subscriptions")" = "Europe/Stockholm 20" ] || fail "sub row"
[ "$(post '{"action":"reminder_unsubscribe","endpoint":"https://fcm.googleapis.com/fcm/send/abc"}')" = 200 ] || fail unsubscribe
[ "$(psql -tAc 'SELECT count(*) FROM push_subscriptions')" = 0 ] || fail "unsub row"
echo "reminders ok"
code=$(curl -sS -b $J -o /dev/null -w '%{http_code}' $B/); [ "$code" = 200 ] || fail "signed-in home $code"
echo "ALL_API_TESTS_OK"
