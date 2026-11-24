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
[ "$(curl -sS -o /dev/null -w "%{http_code}" $B/login)" = 200 ] || fail login
[ "$(curl -sS -o /dev/null -w '%{http_code}' $B/sw.js)" = 200 ] || fail sw
[ "$(curl -sS -o /dev/null -w '%{http_code}' $B/icons/icon-192.png)" = 200 ] || fail icon
[ "$(curl -sS -o /dev/null -w "%{http_code}" $B/js/main.js)" = 200 ] || fail "scripts"
[ "$(curl -sS -o /dev/null -w "%{http_code}" $B/css/base.css)" = 200 ] || fail "styles"
curl -sS -I $B/manifest.webmanifest | grep -qi 'content-type: application/manifest+json' || fail manifest
# Browsers refuse styles and service workers sent with the wrong type.
for check in "/css/base.css text/css" "/js/main.js application/javascript" "/sw.js application/javascript" "/icons/icon-192.png image/png" "/welcome text/html"; do
    set -- $check
    curl -sS -I "$B$1" | grep -qi "^content-type: $2" || fail "content type of $1 should be $2"
done
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

# ---- Weekly review ----
WEEKDAY=$(date -u +%u)
MONDAY=$(date -u -d "@$(( $(date +%s) - (WEEKDAY - 1) * 86400 ))" +%F)
TUESDAY_OR_SUNDAY=$(date -u -d "@$(( $(date +%s) - (WEEKDAY - 1) * 86400 + 86400 ))" +%F)
[ "$(post "{\"action\":\"weekly_review\",\"weekStart\":\"$TUESDAY_OR_SUNDAY\",\"day\":\"$TODAY\"}")" = 400 ] || { cat /tmp/out; fail "review accepted a week that doesn't start on Monday"; }
[ "$(post "{\"action\":\"weekly_review\",\"weekStart\":\"$MONDAY\",\"day\":\"$TODAY\"}")" = 502 ] || { cat /tmp/out; fail "review without AI should fail cleanly"; }
psql -q -v ON_ERROR_STOP=1 -c "INSERT INTO weekly_reviews (user_id, week_start, review) SELECT id, '$MONDAY', '{\"headline\":\"Solid week\",\"went_well\":\"a\",\"watch_out\":\"b\",\"next_week\":\"c\",\"suggest_adjust\":true}' FROM auth_users WHERE email='t@test.se'"
[ "$(post "{\"action\":\"weekly_review\",\"weekStart\":\"$MONDAY\",\"day\":\"$TODAY\"}")" = 200 ] || { cat /tmp/out; fail "saved review"; }
jq -e --arg m "$MONDAY" '.tree.weekly_review.week_start == $m and .tree.weekly_review.review.headline == "Solid week" and .tree.weekly_review.review.suggest_adjust == true' /tmp/out >/dev/null || { cat /tmp/out; fail "review payload"; }
echo "weekly review ok"

# ---- Community: two users, privacy, friends, follows, feed, reactions ----
J2=/tmp/jar2
cpost() { curl -sS -b "$1" -c "$1" -H 'Content-Type: application/json' -o /tmp/out -w '%{http_code}' -X POST "$B/api/community" -d "$2"; }
cget() { curl -sS -b "$1" -o /tmp/out -w '%{http_code}' "$B/api/community?$2"; }
code=$(curl -sS -c $J2 -o /tmp/out -w '%{http_code}' -H 'Content-Type: application/json' -X POST $B/api/auth/signup -d '{"email":"friend@test.se","password":"averylongpassword2"}')
[ "$code" = 201 ] || { cat /tmp/out; fail "second signup $code"; }
A_ID=$(psql -tAc "SELECT id FROM auth_users WHERE email='t@test.se'")
B_ID=$(psql -tAc "SELECT id FROM auth_users WHERE email='friend@test.se'")

[ "$(cget $J2 "action=profile&userId=$A_ID")" = 403 ] || { cat /tmp/out; fail "private profile visible"; }
[ "$(cpost $J '{"action":"privacy","settings":{"profile_visibility":"public","show_goals":true,"show_progress":true,"show_activity":true,"allow_friend_requests":true,"show_in_search":true}}')" = 200 ] || { cat /tmp/out; fail privacy; }
[ "$(cpost $J2 "{\"action\":\"request\",\"userId\":\"$A_ID\"}")" = 200 ] || { cat /tmp/out; fail "friend request"; }
[ "$(cpost $J "{\"action\":\"accept\",\"userId\":\"$B_ID\"}")" = 200 ] || { cat /tmp/out; fail "accept"; }
[ "$(cpost $J2 "{\"action\":\"follow\",\"userId\":\"$A_ID\"}")" = 200 ] || { cat /tmp/out; fail "follow"; }
echo "privacy, friend request, accept, follow ok"

[ "$(post "{\"action\":\"complete\",\"expectedStep\":0,\"day\":\"$TODAY\"}")" = 200 ] || { cat /tmp/out; fail "complete for feed"; }
[ "$(cget $J2 action=feed)" = 200 ] || { cat /tmp/out; fail feed; }
ACTIVITY=$(jq -r '[.activities[] | select(.activity_type == "milestone_completed")][0].id' /tmp/out)
[ -n "$ACTIVITY" ] && [ "$ACTIVITY" != null ] || { cat /tmp/out; fail "milestone in feed"; }
[ "$(cget $J2 action=notifications)" = 200 ] || fail notifications
jq -e '[.notifications[].notification_type] | index("milestone_completed") != null and index("friend_accepted") != null' /tmp/out >/dev/null || { cat /tmp/out; fail "B notifications"; }
[ "$(cpost $J2 "{\"action\":\"react\",\"activityId\":\"$ACTIVITY\",\"reaction\":\"celebrate\"}")" = 200 ] || { cat /tmp/out; fail react; }
[ "$(cget $J action=notifications)" = 200 ] || fail "A notifications"
jq -e '[.notifications[].notification_type] | index("reaction") != null' /tmp/out >/dev/null || { cat /tmp/out; fail "reaction notification"; }
[ "$(cget $J2 "action=profile&userId=$A_ID")" = 200 ] || { cat /tmp/out; fail "public profile"; }
jq -e '.profile.progress.completed_count == 1' /tmp/out >/dev/null || { cat /tmp/out; fail "profile progress"; }
jq -e '.profile.network.goals | length == 1' /tmp/out >/dev/null || { cat /tmp/out; fail "friend network goals"; }
jq -e '.profile.network.goals[0].goal == "G" and (.profile.network.goals[0].completed | length == 1)' /tmp/out >/dev/null || { cat /tmp/out; fail "friend network content"; }
jq -e '(.profile.network.checkin_days | length >= 1) and (.profile.network | tostring | contains("ran 2 km") | not)' /tmp/out >/dev/null || { cat /tmp/out; fail "friend check-in days without notes"; }
[ "$(cpost $J '{"action":"privacy","settings":{"profile_visibility":"public","show_goals":false,"show_progress":true,"show_activity":true,"allow_friend_requests":true,"show_in_search":true}}')" = 200 ] || fail "privacy without goals"
[ "$(cget $J2 "action=profile&userId=$A_ID")" = 200 ] || fail "profile without goals"
jq -e '.profile.network.goals[0].goal == "Goal 1"' /tmp/out >/dev/null || { cat /tmp/out; fail "goal name hidden"; }
[ "$(cpost $J '{"action":"privacy","settings":{"profile_visibility":"public","show_goals":false,"show_progress":false,"show_activity":true,"allow_friend_requests":true,"show_in_search":true}}')" = 200 ] || fail "privacy without progress"
[ "$(cget $J2 "action=profile&userId=$A_ID")" = 200 ] || fail "profile without progress"
jq -e '.profile.network == null' /tmp/out >/dev/null || { cat /tmp/out; fail "network hidden without show_progress"; }
echo "friend network ok"
echo "feed, notifications, reactions, profile ok"

code=$(curl -sS -b $J -o /dev/null -w '%{http_code}' $B/); [ "$code" = 200 ] || fail "signed-in home $code"
echo "ALL_API_TESTS_OK"
