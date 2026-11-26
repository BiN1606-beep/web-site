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
jq -e '.reminders_key | startswith("B") and length == 87' /tmp/out >/dev/null || fail "reminders_key"
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

# ---- Topaz gems: paid once per check-in per day, spent on streak freezes ----
# Check-in, finish a step, undo it: still only one payout today.
[ "$(post "{\"action\":\"checkin\",\"day\":\"$TODAY\",\"note\":\"ran 2 km\"}")" = 200 ] || fail "check in again"
jq -e '.tree.topaz.balance == 10 and .tree.topaz.freeze_price == 70 and (.tree.topaz.purchases | length == 0)' /tmp/out >/dev/null || { cat /tmp/out; fail "topaz once a day"; }
[ "$(post "{\"action\":\"buy_freeze\",\"day\":\"$TODAY\"}")" = 409 ] || { cat /tmp/out; fail "can't buy without topaz"; }
[ "$(post '{"action":"buy_freeze","day":"nope"}')" = 400 ] || fail "buy needs a date"
psql -q -c "UPDATE topaz_wallets SET balance = 300"
[ "$(post "{\"action\":\"buy_freeze\",\"day\":\"$OLD\"}")" = 409 ] || { cat /tmp/out; fail "old day purchase"; }
[ "$(post "{\"action\":\"buy_freeze\",\"day\":\"$TODAY\"}")" = 200 ] || { cat /tmp/out; fail "buy freeze"; }
jq -e --arg d "$TODAY" '.tree.topaz.balance == 230 and .tree.topaz.purchases == [$d]' /tmp/out >/dev/null || { cat /tmp/out; fail "freeze bought"; }
post "{\"action\":\"buy_freeze\",\"day\":\"$TODAY\"}" >/dev/null
[ "$(post "{\"action\":\"buy_freeze\",\"day\":\"$TODAY\"}")" = 200 ] || { cat /tmp/out; fail "third freeze"; }
[ "$(post "{\"action\":\"buy_freeze\",\"day\":\"$TODAY\"}")" = 409 ] || { cat /tmp/out; fail "only 3 bought freezes"; }
[ "$(psql -tAc "SELECT balance FROM topaz_wallets") $(psql -tAc "SELECT count(*) FROM freeze_purchases")" = "90 3" ] || fail "full slots cost nothing"
echo "topaz and freezes ok"

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

# Like TikTok: a private profile shows only its name and counts, and a
# follow to it is a request until the owner accepts it.
[ "$(cget $J2 "action=profile&userId=$A_ID")" = 200 ] || { cat /tmp/out; fail "private profile header"; }
jq -e '.profile.private == true and .profile.bio == "" and .profile.network == null and .profile.i_follow == "none"' /tmp/out >/dev/null || { cat /tmp/out; fail "private profile hides details"; }
[ "$(cpost $J2 "{\"action\":\"follow\",\"userId\":\"$A_ID\"}")" = 200 ] || { cat /tmp/out; fail "follow request"; }
jq -e '.i_follow == "pending" and .friends == false' /tmp/out >/dev/null || { cat /tmp/out; fail "follow to a private profile is a request"; }
[ "$(cget $J action=summary)" = 200 ] || fail "summary"
jq -e --argjson b "$B_ID" '(.requests | length == 1) and .requests[0].id == $b and (.followers | length == 0)' /tmp/out >/dev/null || { cat /tmp/out; fail "request in summary"; }
[ "$(cpost $J "{\"action\":\"accept\",\"userId\":\"$B_ID\"}")" = 200 ] || { cat /tmp/out; fail "accept"; }
[ "$(cget $J2 "action=profile&userId=$A_ID")" = 200 ] || { cat /tmp/out; fail "profile after accept"; }
jq -e '.profile.private == false and .profile.i_follow == "accepted" and .profile.follower_count == 1' /tmp/out >/dev/null || { cat /tmp/out; fail "accepted follower sees the profile"; }
[ "$(cpost $J '{"action":"privacy","settings":{"profile_visibility":"public","show_goals":true,"show_progress":true,"show_activity":true,"allow_friend_requests":true,"show_in_search":true}}')" = 200 ] || { cat /tmp/out; fail privacy; }
# B's profile is private, but A can follow back right away: that makes friends.
[ "$(cpost $J "{\"action\":\"follow\",\"userId\":\"$B_ID\"}")" = 200 ] || { cat /tmp/out; fail "follow back"; }
jq -e '.i_follow == "accepted" and .friends == true' /tmp/out >/dev/null || { cat /tmp/out; fail "follow back makes friends"; }
[ "$(cget $J action=summary)" = 200 ] || fail "summary after follow back"
jq -e --argjson b "$B_ID" '(.friends | length == 1) and .friends[0].id == $b and .friends[0].follows_me == true and .friends[0].i_follow == "accepted"' /tmp/out >/dev/null || { cat /tmp/out; fail "friends list"; }
echo "privacy, follow request, accept, follow back ok"

[ "$(post "{\"action\":\"complete\",\"expectedStep\":0,\"day\":\"$TODAY\"}")" = 200 ] || { cat /tmp/out; fail "complete for feed"; }
[ "$(cget $J2 action=feed)" = 200 ] || { cat /tmp/out; fail feed; }
ACTIVITY=$(jq -r '[.activities[] | select(.activity_type == "milestone_completed")][0].id' /tmp/out)
[ -n "$ACTIVITY" ] && [ "$ACTIVITY" != null ] || { cat /tmp/out; fail "milestone in feed"; }
[ "$(cget $J2 action=notifications)" = 200 ] || fail notifications
jq -e '[.notifications[].notification_type] | index("milestone_completed") != null and index("follow_accepted") != null and index("new_friend") != null' /tmp/out >/dev/null || { cat /tmp/out; fail "B notifications"; }
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

# ---- Shared trees: grow only on days both friends water ----
tpost() { cpost "$1" "{\"action\":\"$2\",\"treeId\":\"$TREE\",\"day\":\"$TODAY\",\"note\":\"$3\"}"; }
[ "$(cpost $J "{\"action\":\"tree_plant\",\"userId\":\"$B_ID\",\"title\":\"Run together\"}")" = 201 ] || { cat /tmp/out; fail "plant"; }
TREE=$(jq -r .id /tmp/out)
[ "$(cpost $J2 "{\"action\":\"tree_plant\",\"userId\":\"$A_ID\",\"title\":\"Again\"}")" = 409 ] || { cat /tmp/out; fail "one tree per pair"; }
[ "$(tpost $J tree_water "ran")" = 409 ] || { cat /tmp/out; fail "invited tree can't be watered"; }
[ "$(tpost $J tree_accept "")" = 200 ] && fail "planter can't accept own invite" || true
[ "$(tpost $J2 tree_accept "")" = 200 ] || { cat /tmp/out; fail "accept tree"; }
[ "$(tpost $J tree_water "ran 3 km")" = 200 ] || { cat /tmp/out; fail "water"; }
jq -e '.grew == false and .topaz.balance == 100' /tmp/out >/dev/null || { cat /tmp/out; fail "one watering doesn't grow, pays 10 topaz"; }
[ "$(cget $J2 "action=trees&day=$TODAY")" = 200 ] || { cat /tmp/out; fail "trees"; }
jq -e --arg t "$TODAY" '.trees[0].grown == 0 and .trees[0].status == "growing" and .trees[0].days[0].day == $t and .trees[0].days[0].partner == "ran 3 km" and .trees[0].days[0].me == null' /tmp/out >/dev/null || { cat /tmp/out; fail "tree waiting for B"; }
# Side quest: A checked in, B hasn't. Not when yesterday was already saved.
psql -q -c "INSERT INTO shared_tree_side_quests (tree_id, user_id, day, quest) VALUES ($TREE, $A_ID, '$TODAY'::date - 1, 'x')"
[ "$(tpost $J tree_side_quest "")" = 409 ] || { cat /tmp/out; fail "no side quest two days in a row"; }
psql -q -c "DELETE FROM shared_tree_side_quests WHERE tree_id = $TREE"
[ "$(tpost $J2 tree_side_quest "")" = 409 ] || { cat /tmp/out; fail "side quest needs your own check-in"; }
[ "$(tpost $J tree_side_quest "")" = 200 ] || { cat /tmp/out; fail "side quest"; }
[ "$(cget $J "action=trees&day=$TODAY")" = 200 ] || fail "trees after side quest"
jq -e '.trees[0].days[0].saved == "me" and (.trees[0].days[0].quest | length > 0) and .trees[0].grown == 0 and (.trees[0].side_quest | length > 0)' /tmp/out >/dev/null || { cat /tmp/out; fail "side quest saves but doesn't grow"; }
# A nudges B, who hasn't checked in yet: once a day.
[ "$(tpost $J tree_nudge "")" = 200 ] || { cat /tmp/out; fail "nudge"; }
jq -e '.already == false' /tmp/out >/dev/null || { cat /tmp/out; fail "first nudge"; }
[ "$(tpost $J tree_nudge "")" = 200 ] || { cat /tmp/out; fail "nudge again"; }
jq -e '.already == true' /tmp/out >/dev/null || { cat /tmp/out; fail "second nudge is the same one"; }
[ "$(cget $J "action=trees&day=$TODAY")" = 200 ] && jq -e '.trees[0].nudged_today == true' /tmp/out >/dev/null || { cat /tmp/out; fail "nudged_today"; }
[ "$(psql -tAc "SELECT count(*) FROM user_notifications WHERE notification_type = 'tree_nudge' AND user_id = $B_ID")" = 1 ] || fail "one nudge notification"
[ "$(psql -tAc "SELECT count(*) FROM shared_tree_nudges WHERE to_user = $B_ID AND pushed_at IS NULL")" = 1 ] || fail "nudge waits for the push sender"
[ "$(tpost $J2 tree_water "did yoga")" = 200 ] || { cat /tmp/out; fail "water B"; }
jq -e '.grew == true' /tmp/out >/dev/null || { cat /tmp/out; fail "both watered grows"; }
# Both checked in: no nudge needed either way.
[ "$(tpost $J2 tree_nudge "")" = 409 ] || { cat /tmp/out; fail "no nudge for someone who checked in"; }
[ "$(tpost $J tree_nudge "")" = 409 ] || { cat /tmp/out; fail "no nudge after check-in"; }
[ "$(tpost $J2 tree_water "did yoga twice")" = 200 ] || { cat /tmp/out; fail "edit watering"; }
[ "$(cget $J "action=trees&day=$TODAY")" = 200 ] || fail "trees A"
jq -e '.trees[0].grown == 1 and .trees[0].days[0].partner == "did yoga twice" and .trees[0].still_friends == true' /tmp/out >/dev/null || { cat /tmp/out; fail "tree grew"; }
[ "$(cget $J action=notifications)" = 200 ] || fail "tree notifications"
jq -e '[.notifications[].notification_type] | (index("tree_started") != null) and (index("tree_grew") != null)' /tmp/out >/dev/null || { cat /tmp/out; fail "tree notifications"; }
[ "$(cget $J2 action=notifications)" = 200 ] || fail "B tree notifications"
jq -e '[.notifications[].notification_type] | (index("tree_invite") != null) and (index("tree_watered") != null)' /tmp/out >/dev/null || { cat /tmp/out; fail "B tree notifications"; }
# Unfollowing pauses the tree; following back lets it grow again.
[ "$(cpost $J2 "{\"action\":\"unfollow\",\"userId\":\"$A_ID\"}")" = 200 ] || fail unfollow
[ "$(tpost $J tree_water "again")" = 409 ] || { cat /tmp/out; fail "not friends can't water"; }
[ "$(cpost $J2 "{\"action\":\"follow\",\"userId\":\"$A_ID\"}")" = 200 ] || fail "follow again"
jq -e '.friends == true' /tmp/out >/dev/null || { cat /tmp/out; fail "friends again"; }
[ "$(tpost $J tree_water "again")" = 200 ] || { cat /tmp/out; fail "water after follow back"; }
jq -e '.topaz.balance == 100' /tmp/out >/dev/null || { cat /tmp/out; fail "a shared goal pays once a day"; }
[ "$(psql -tAc "SELECT count(*) FROM topaz_earnings WHERE user_id = $B_ID AND reason = 'shared_checkin'")" = 1 ] || fail "B paid once"
[ "$(tpost $J tree_remove "")" = 200 ] || fail "remove tree"
[ "$(cget $J "action=trees&day=$TODAY")" = 200 ] || fail "trees after remove"
jq -e '.trees | length == 0' /tmp/out >/dev/null || { cat /tmp/out; fail "removed tree hidden"; }
# Removing a follower: B stops following A.
[ "$(cpost $J "{\"action\":\"remove_follower\",\"userId\":\"$B_ID\"}")" = 200 ] || fail "remove follower"
[ "$(cget $J2 "action=profile&userId=$A_ID")" = 200 ] || fail "profile after removal"
jq -e '.profile.i_follow == "none"' /tmp/out >/dev/null || { cat /tmp/out; fail "removed follower no longer follows"; }
echo "shared trees ok"

# ---- Network style: saved per account, junk dropped ----
style() { curl -sS -b $J -H 'Content-Type: application/json' -o /tmp/out -w '%{http_code}' -X POST "$B/api/network-style" -d "$1"; }
[ "$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' $B/api/network-style -d '{"style":{}}')" = 401 ] || fail "style signed out"
[ "$(style '{"nope":1}')" = 400 ] || fail "style without style"
[ "$(style '{"style":{"shape":"galaxy","palette":"ocean","sky":"stars","pull":0.734,"spread":2,"dots":0.2,"curved":true,"names":"yes","evil":"<script>"}}')" = 200 ] || { cat /tmp/out; fail "save style"; }
curl -sS -b $J -o /tmp/out $B/api/progress-tree
jq -e '.network_style.shape == "galaxy" and .network_style.sky == "stars" and .network_style.pull == 0.73 and .network_style.curved == true' /tmp/out >/dev/null || { cat /tmp/out; fail "style in progress tree"; }
jq -e '.network_style | has("spread") or has("names") or has("evil") | not' /tmp/out >/dev/null || { cat /tmp/out; fail "bad style values kept"; }
[ "$(style '{"style":{"shape":"pyramid"}}')" = 200 ] || fail "unknown shape"
jq -e '.style | has("shape") | not' /tmp/out >/dev/null || { cat /tmp/out; fail "unknown shape kept"; }
[ "$(style '{"reset":true}')" = 200 ] || fail "reset style"
curl -sS -b $J -o /tmp/out $B/api/network-style
jq -e '.style == null' /tmp/out >/dev/null || { cat /tmp/out; fail "style after reset"; }
echo "network style ok"

# ---- Appearance (theme and fonts): saved per account the same way ----
look() { curl -sS -b $J -H 'Content-Type: application/json' -o /tmp/out -w '%{http_code}' -X POST "$B/api/appearance" -d "$1"; }
[ "$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' $B/api/appearance -d '{"style":{}}')" = 401 ] || fail "appearance signed out"
[ "$(look '{"nope":1}')" = 400 ] || fail "appearance without style"
[ "$(look '{"style":{"theme":"mocha","heading_font":"press-start","text_font":"jetbrains-mono-nerd","evil":"<b>"}}')" = 200 ] || { cat /tmp/out; fail "save appearance"; }
curl -sS -b $J -o /tmp/out $B/api/progress-tree
jq -e '.appearance.theme == "mocha" and .appearance.heading_font == "press-start" and .appearance.text_font == "jetbrains-mono-nerd" and (.appearance | has("evil") | not)' /tmp/out >/dev/null || { cat /tmp/out; fail "appearance in progress tree"; }
# The network style is a separate choice and stays as it was.
jq -e '.network_style == null' /tmp/out >/dev/null || { cat /tmp/out; fail "appearance changed network style"; }
# Playful heading-only fonts and unknown themes are dropped.
[ "$(look '{"style":{"theme":"neon","text_font":"press-start"}}')" = 200 ] || fail "unknown appearance"
jq -e '.style | has("theme") or has("text_font") | not' /tmp/out >/dev/null || { cat /tmp/out; fail "unknown appearance kept"; }
[ "$(look '{"reset":true}')" = 200 ] || fail "reset appearance"
curl -sS -b $J -o /tmp/out $B/api/appearance
jq -e '.style == null' /tmp/out >/dev/null || { cat /tmp/out; fail "appearance after reset"; }
echo "appearance ok"

# Dev tools are only for the accounts in lua/debug_menu_email.txt, which
# this test account is not: every call must be refused by the server.
[ "$(curl -sS -o /dev/null -w '%{http_code}' $B/api/dev)" = 401 ] || fail "dev tools signed out"
[ "$(curl -sS -b $J -o /dev/null -w '%{http_code}' $B/api/dev)" = 403 ] || fail "dev tools snapshot for a normal account"
[ "$(curl -sS -b $J -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X POST $B/api/dev -d '{"action":"clear_checkins"}')" = 403 ] || fail "dev action for a normal account"
curl -sS -b $J $B/api/progress-tree | jq -e '.dev == null' >/dev/null || fail "dev flag for a normal account"
echo "dev tools locked for normal accounts ok"

code=$(curl -sS -b $J -o /dev/null -w '%{http_code}' $B/); [ "$code" = 200 ] || fail "signed-in home $code"
echo "ALL_API_TESTS_OK"
