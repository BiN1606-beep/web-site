#!/bin/sh
# API tests for /api/routines (lua/osiris/routines.lua). Run after
# api_test.sh by tests/run_all.sh, with a fresh account of its own.
set -eu
B=${BASE_URL:-http://127.0.0.1:8080}
J=/tmp/routine-jar
J2=/tmp/routine-jar-2
TODAY=$(date -u +%F)
OLD=$(date -u -d "@$(( $(date +%s) - 5*86400 ))" +%F)
fail() { echo "FAIL: $*"; exit 1; }
rpost() { curl -sS -b "$1" -c "$1" -H 'Content-Type: application/json' -o /tmp/rout -w '%{http_code}' -X POST "$B/api/routines" -d "$2"; }
r() { rpost $J "$1"; }

[ "$(curl -sS -o /dev/null -w '%{http_code}' $B/api/routines)" = 401 ] || fail "routines signed out"
for jar in $J $J2; do
    n=$([ $jar = $J ] && echo r1 || echo r2)
    code=$(curl -sS -c $jar -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -X POST $B/api/auth/signup -d "{\"email\":\"$n@test.se\",\"password\":\"averylongpassword1\"}")
    [ "$code" = 201 ] || fail "signup $n $code"
done

curl -sS -b $J -o /tmp/rout $B/api/routines
jq -e '.routines == [] and .checks == []' /tmp/rout >/dev/null || { cat /tmp/rout; fail "empty routines should be lists"; }

# Bad input is refused.
[ "$(r '{"action":"add","title":"","repeat":{"kind":"daily"},"day":"'$TODAY'"}')" = 400 ] || fail "blank title"
[ "$(r '{"action":"add","title":"   ","repeat":{"kind":"daily"},"day":"'$TODAY'"}')" = 400 ] || fail "space title"
LONG=$(printf 'x%.0s' $(seq 1 81))
[ "$(r '{"action":"add","title":"'$LONG'","repeat":{"kind":"daily"},"day":"'$TODAY'"}')" = 400 ] || fail "long title"
[ "$(r '{"action":"add","title":"a","repeat":{"kind":"hourly"},"day":"'$TODAY'"}')" = 400 ] || fail "bad kind"
[ "$(r '{"action":"add","title":"a","repeat":{"kind":"weekdays","days":[]},"day":"'$TODAY'"}')" = 400 ] || fail "no days"
[ "$(r '{"action":"add","title":"a","repeat":{"kind":"weekdays","days":[7]},"day":"'$TODAY'"}')" = 400 ] || fail "day 7"
[ "$(r '{"action":"add","title":"a","repeat":{"kind":"weekdays","days":[1.5]},"day":"'$TODAY'"}')" = 400 ] || fail "day 1.5"
[ "$(r '{"action":"add","title":"a","repeat":{"kind":"every","every":31},"day":"'$TODAY'"}')" = 400 ] || fail "every 31"
[ "$(r '{"action":"add","title":"a","repeat":{"kind":"every","every":0},"day":"'$TODAY'"}')" = 400 ] || fail "every 0"
[ "$(r '{"action":"add","title":"a","repeat":{"kind":"daily"},"day":"'$OLD'"}')" = 400 ] || fail "old day"
[ "$(r '{"action":"add","title":"a","repeat":{"kind":"daily"},"day":"2026-02-31"}')" = 400 ] || fail "impossible day"
[ "$(r '{"action":"fly"}')" = 400 ] || fail "unknown action"
[ "$(r '{"action":"debug_reset"}')" = 403 ] || fail "debug reset for normal user"
echo "routine input checks ok"

# Add three routines.
[ "$(r '{"action":"add","title":"  Drink\u0007 water  ","repeat":{"kind":"daily"},"day":"'$TODAY'"}')" = 200 ] || { cat /tmp/rout; fail "add daily"; }
WATER=$(jq -r .added /tmp/rout)
jq -e --arg d "$TODAY" '.routines[0].title == "Drink water" and .routines[0].repeat == {"kind":"daily"} and .routines[0].start_day == $d' /tmp/rout >/dev/null || { cat /tmp/rout; fail "daily saved"; }
[ "$(r '{"action":"add","title":"Gym","repeat":{"kind":"weekdays","days":[4,0,2,2]},"day":"'$TODAY'"}')" = 200 ] || { cat /tmp/rout; fail "add weekdays"; }
GYM=$(jq -r .added /tmp/rout)
jq -e '.routines[1].repeat == {"kind":"weekdays","days":[0,2,4]}' /tmp/rout >/dev/null || { cat /tmp/rout; fail "weekdays saved"; }
[ "$(r '{"action":"add","title":"Call grandma","repeat":{"kind":"every","every":3},"day":"'$TODAY'"}')" = 200 ] || fail "add every"
CALL=$(jq -r .added /tmp/rout)
jq -e '.routines | length == 3' /tmp/rout >/dev/null || fail "three routines"
echo "add ok"

# Tick off. "Call grandma" (every 3 days from today) is on today; the gym
# only on Mon/Wed/Fri.
[ "$(r '{"action":"check","id":'$WATER',"day":"'$TODAY'","done":true}')" = 200 ] || { cat /tmp/rout; fail check; }
jq -e --arg d "$TODAY" --argjson id $WATER '.checks == [{"routine_id":$id,"day":$d}] and .day_complete == false' /tmp/rout >/dev/null || { cat /tmp/rout; fail "check saved"; }
[ "$(r '{"action":"check","id":'$WATER',"day":"'$TODAY'","done":true}')" = 200 ] || fail "check twice"
jq -e '.checks | length == 1' /tmp/rout >/dev/null || fail "double check stored twice"
[ "$(r '{"action":"check","id":'$WATER',"day":"'$OLD'","done":true}')" = 400 ] || fail "old check"
WEEKDAY=$(( $(date -u +%u) - 1 ))
case $WEEKDAY in 0|2|4) GYM_TODAY=1 ;; *) GYM_TODAY=0 ;; esac
if [ $GYM_TODAY = 0 ]; then
    [ "$(r '{"action":"check","id":'$GYM',"day":"'$TODAY'","done":true}')" = 400 ] || fail "gym ticked on a rest day"
else
    [ "$(r '{"action":"check","id":'$GYM',"day":"'$TODAY'","done":true}')" = 200 ] || fail "gym tick"
fi
[ "$(r '{"action":"check","id":'$CALL',"day":"'$TODAY'","done":true}')" = 200 ] || fail "call tick"
jq -e '.day_complete == true' /tmp/rout >/dev/null || { cat /tmp/rout; fail "last tick should complete the day"; }
[ "$(r '{"action":"check","id":'$CALL',"day":"'$TODAY'","done":false}')" = 200 ] || fail "untick"
jq -e --argjson id $CALL '[.checks[] | select(.routine_id == $id)] | length == 0' /tmp/rout >/dev/null || fail "untick saved"
echo "check ok"

# Edit.
[ "$(r '{"action":"edit","id":'$GYM',"title":"Gym session","repeat":{"kind":"every","every":2}}')" = 200 ] || { cat /tmp/rout; fail edit; }
jq -e --argjson id $GYM '.routines[] | select(.id == $id) | .title == "Gym session" and .repeat == {"kind":"every","every":2}' /tmp/rout >/dev/null || fail "edit saved"
[ "$(r '{"action":"edit","id":"'$GYM'","title":"x","repeat":{"kind":"daily"}}')" = 404 ] || fail "string id"
echo "edit ok"

# Somebody else can't see, tick, change or remove your routines.
curl -sS -b $J2 -o /tmp/rout $B/api/routines
jq -e '.routines == [] and .checks == []' /tmp/rout >/dev/null || { cat /tmp/rout; fail "other user sees routines"; }
[ "$(rpost $J2 '{"action":"check","id":'$WATER',"day":"'$TODAY'","done":false}')" = 404 ] || fail "other user ticks"
[ "$(rpost $J2 '{"action":"edit","id":'$WATER',"title":"hacked","repeat":{"kind":"daily"}}')" = 404 ] || fail "other user edits"
[ "$(rpost $J2 '{"action":"remove","id":'$WATER',"day":"'$TODAY'"}')" = 404 ] || fail "other user removes"
[ "$(psql -tAc "SELECT title FROM routines WHERE id = $WATER")" = "Drink water" ] || fail "other user changed it"
[ "$(psql -tAc "SELECT count(*) FROM routine_checks WHERE routine_id = $WATER")" = 1 ] || fail "other user unticked"
echo "only your own ok"

# Removing a routine made today deletes it; an older one keeps its history.
psql -q -v ON_ERROR_STOP=1 -c "UPDATE routines SET start_day = '$OLD' WHERE id = $WATER"
psql -q -v ON_ERROR_STOP=1 -c "INSERT INTO routine_checks (routine_id, user_id, day) SELECT $WATER, user_id, '$OLD' FROM routines WHERE id = $WATER"
[ "$(r '{"action":"remove","id":'$WATER',"day":"'$TODAY'"}')" = 200 ] || { cat /tmp/rout; fail "remove old"; }
jq -e --arg d "$TODAY" --argjson id $WATER '(.routines[] | select(.id == $id) | .removed_on == $d) and ([.checks[] | select(.routine_id == $id)] | length == 2)' /tmp/rout >/dev/null || { cat /tmp/rout; fail "removed keeps history"; }
[ "$(r '{"action":"check","id":'$WATER',"day":"'$TODAY'","done":true}')" = 404 ] || fail "tick removed"
[ "$(r '{"action":"remove","id":'$CALL',"day":"'$TODAY'"}')" = 200 ] || fail "remove new"
[ "$(psql -tAc "SELECT count(*) FROM routines WHERE id = $CALL")" = 0 ] || fail "new routine should be deleted"
echo "remove ok"

# At most 20 routines at a time.
i=0
while [ $i -lt 25 ]; do
    r '{"action":"add","title":"R'$i'","repeat":{"kind":"daily"},"day":"'$TODAY'"}' >/dev/null
    i=$((i + 1))
done
[ "$(psql -tAc "SELECT count(*) FROM routines r JOIN auth_users u ON u.id = r.user_id WHERE u.email = 'r1@test.se' AND removed_on IS NULL")" = 20 ] || fail "limit"
[ "$(r '{"action":"add","title":"one more","repeat":{"kind":"daily"},"day":"'$TODAY'"}')" = 409 ] || fail "limit status"
echo "limit ok"

# Dev tools: a debug account gets a Routines card and its buttons work;
# everyone else gets nothing (devtools.lua checks that).
dev() { curl -sS -b $J -H 'Content-Type: application/json' -o /tmp/rout -w '%{http_code}' -X POST "$B/api/dev" -d "$1"; }
[ "$(dev '{"action":"routines_reset"}')" = 403 ] || fail "routine dev action for a normal account"
DEBUG_FILE=/opt/mysite/lua/debug_menu_email.txt
if [ -w /opt/mysite/lua ]; then
    printf 'r1@test.se\n' > $DEBUG_FILE
    curl -sS -b $J -o /tmp/rout "$B/api/dev?today=$TODAY"
    jq -e '.snapshot.extras[] | select(.id == "routines") | .stats[0].value == 20' /tmp/rout >/dev/null || { cat /tmp/rout; fail "dev routines card"; }
    [ "$(dev '{"action":"routines_tick_today","today":"'$TODAY'"}')" = 200 ] || { cat /tmp/rout; fail "dev tick today"; }
    jq -e '.snapshot.extras[] | select(.id == "routines") | .stats[1].value >= 20' /tmp/rout >/dev/null || { cat /tmp/rout; fail "dev ticked"; }
    [ "$(dev '{"action":"routines_clear_ticks","today":"'$TODAY'"}')" = 200 ] || fail "dev clear ticks"
    [ "$(psql -tAc "SELECT count(*) FROM routine_checks c JOIN auth_users u ON u.id = c.user_id WHERE u.email = 'r1@test.se'")" = 0 ] || fail "dev cleared"
    [ "$(r '{"action":"debug_reset"}')" = 200 ] || fail "debug_reset for debug account"
    jq -e '.routines == []' /tmp/rout >/dev/null || fail "debug_reset emptied"
    rm -f $DEBUG_FILE
    echo "dev tools ok"
fi

echo "ALL_ROUTINE_TESTS_OK"
