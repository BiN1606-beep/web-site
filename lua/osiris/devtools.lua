-- The /api/dev endpoint: the developer tools panel (public/js/devtools.js).
--
-- Only the accounts listed in lua/debug_menu_email.txt (the same list as the
-- old debug menu and the stats page) get an answer. Everyone else gets 403,
-- and the page never shows them the panel or the button that opens it.
--
-- GET  /api/dev?today=YYYY-MM-DD  -> { snapshot = {...} }
--      Everything about YOUR account in one answer: goals, check-ins,
--      reviews, follows, shared trees, reminders and saved looks.
-- POST /api/dev { action = "...", today = "YYYY-MM-DD", ... }
--      Runs one of the ACTIONS below and answers with a fresh snapshot.
--
-- Every action only touches rows that belong to the signed-in account (or a
-- shared tree it is part of). "today" comes from the browser, because only
-- the browser knows the user's own date (the same rule as check-ins).
--
-- Adding a tool for a new feature (gems, stored streak freezes, ...):
--   1. add what it should show to EXTRA_SECTIONS (the panel draws any
--      section there as a card with numbers and buttons, no JS needed), and
--   2. add each button's action to ACTIONS.

local cjson = require "cjson.safe"
local M = {}
local common = require "osiris.common"
local goals = require "osiris.goals"

local respond = common.respond
local database_query = common.database_query
local current_user = common.current_user
local read_json_body = common.read_json_body
local valid_checkin_day = goals.valid_checkin_day
local is_progress_debug_user = goals.is_progress_debug_user

-- How many days with no check-in break any streak: one more than the most
-- streak freezes you can hold (MAX_FREEZES in public/js/streak.js).
local STREAK_BREAK_DAYS = 3

-- ---- What the panel shows ----

-- One query that collects the whole picture as JSON inside PostgreSQL.
-- $1 = user id, $2 = the browser's today.
local SNAPSHOT_SQL = [[
SELECT json_build_object(
    'today', $2::date,
    'account', (
        SELECT json_build_object(
            'id', u.id,
            'email', u.email,
            'name', u.profile_display_name,
            'joined', u.created_at,
            'onboarding_seen', u.profile_onboarding_seen,
            'google', u.google_sub IS NOT NULL,
            'password', u.password_hash IS NOT NULL,
            'picture', u.profile_picture IS NOT NULL,
            'custom_look', u.appearance IS NOT NULL,
            'custom_network', u.network_style IS NOT NULL,
            'sessions', (SELECT count(*) FROM public.auth_sessions s
                         WHERE s.user_id = u.id AND s.expires_at > now())
        )
        FROM public.auth_users u WHERE u.id = $1
    ),
    'goals', (
        SELECT COALESCE(json_agg(json_build_object(
            'id', g.id,
            'title', g.tree_data->>'goal',
            'area', g.tree_data->>'area',
            'done', g.completed_count,
            'total', jsonb_array_length(COALESCE(g.tree_data->'steps', '[]'::jsonb)),
            'active', g.is_active,
            'interview', g.tree_data IS NULL,
            'grows_from', g.tree_data->'grows_from',
            'created', g.created_at
        ) ORDER BY g.created_at), '[]'::json)
        FROM public.user_progress_trees g WHERE g.user_id = $1
    ),
    'steps_finished', (SELECT count(*) FROM public.step_completions WHERE user_id = $1),
    'checkins', (
        SELECT COALESCE(json_agg(json_build_object('day', c.day::text, 'note', c.note)
                                 ORDER BY c.day DESC), '[]'::json)
        FROM (SELECT day, note FROM public.daily_checkins
              WHERE user_id = $1 ORDER BY day DESC LIMIT 400) c
    ),
    'checkin_total', (SELECT count(*) FROM public.daily_checkins WHERE user_id = $1),
    'reviews', json_build_object(
        'total', (SELECT count(*) FROM public.weekly_reviews WHERE user_id = $1),
        'this_week', EXISTS (SELECT 1 FROM public.weekly_reviews
                             WHERE user_id = $1 AND week_start = date_trunc('week', $2::date)::date)
    ),
    'social', json_build_object(
        'visibility', (SELECT profile_visibility FROM public.user_social_settings WHERE user_id = $1),
        'following', (SELECT count(*) FROM public.user_follows WHERE follower_id = $1 AND status = 'accepted'),
        'followers', (SELECT count(*) FROM public.user_follows WHERE followed_id = $1 AND status = 'accepted'),
        'friends', (SELECT count(*) FROM public.user_friends WHERE user_id = $1),
        'requests_in', (SELECT count(*) FROM public.user_follows WHERE followed_id = $1 AND status = 'pending'),
        'requests_out', (SELECT count(*) FROM public.user_follows WHERE follower_id = $1 AND status = 'pending'),
        'notifications', (SELECT count(*) FROM public.user_notifications WHERE user_id = $1),
        'unread', (SELECT count(*) FROM public.user_notifications WHERE user_id = $1 AND read_at IS NULL),
        'activities', (SELECT count(*) FROM public.community_activities WHERE actor_id = $1)
    ),
    'shared_trees', (
        SELECT COALESCE(json_agg(json_build_object(
            'id', t.id,
            'title', t.title,
            'status', t.status,
            'planted_by_me', t.planted_by = $1,
            'partner', COALESCE(NULLIF(p.profile_display_name, ''), 'Member ' || p.id),
            -- The tree grows one step for every day BOTH of you watered it.
            'grown', (SELECT count(*) FROM (
                        SELECT day FROM public.shared_tree_waterings w
                        WHERE w.tree_id = t.id GROUP BY day HAVING count(*) >= 2) both_days),
            'me_today', EXISTS (SELECT 1 FROM public.shared_tree_waterings w
                                WHERE w.tree_id = t.id AND w.user_id = $1 AND w.day = $2::date),
            'partner_today', EXISTS (SELECT 1 FROM public.shared_tree_waterings w
                                     WHERE w.tree_id = t.id AND w.user_id = p.id AND w.day = $2::date)
        ) ORDER BY t.created_at DESC), '[]'::json)
        FROM public.shared_trees t
        JOIN public.auth_users p
          ON p.id = CASE WHEN t.user_low = $1 THEN t.user_high ELSE t.user_low END
        WHERE $1 IN (t.user_low, t.user_high)
    ),
    'reminders', (
        SELECT COALESCE(json_agg(json_build_object(
            'hour', remind_hour, 'timezone', timezone, 'last_sent', last_sent_day::text
        )), '[]'::json)
        FROM public.push_subscriptions WHERE user_id = $1
    )
)::text AS snapshot
]]

-- Extra cards for newer features. Each entry is a function(user, today)
-- that returns nil (nothing to show) or a table like:
--   { id = "gems", title = "Gems",
--     stats = { { label = "Gems", value = 120 }, { label = "Freezes", value = 1 } },
--     actions = { { action = "gems_add", label = "+100", amount = 100 },
--                 { action = "gems_reset", label = "Reset", danger = true } } }
-- The panel draws it as a card; the buttons POST { action, amount } here.
local EXTRA_SECTIONS = {}

local function load_snapshot(user, today)
    local rows = database_query(SNAPSHOT_SQL, user.id, today)
    local snapshot = rows and rows[1] and cjson.decode(rows[1].snapshot)
    if not snapshot then
        return nil
    end
    -- cjson reads an empty JSON list back as an empty table, which it
    -- would send on as {} instead of []. Mark the lists as lists.
    for _, key in ipairs({ "goals", "checkins", "shared_trees", "reminders" }) do
        if type(snapshot[key]) == "table" and next(snapshot[key]) == nil then
            snapshot[key] = setmetatable({}, cjson.empty_array_mt)
        end
    end
    local extras = {}
    for _, section in ipairs(EXTRA_SECTIONS) do
        local ok, card = pcall(section, user, today)
        if ok and card then
            extras[#extras + 1] = card
        elseif not ok then
            ngx.log(ngx.ERR, "Dev tools section failed: ", card)
        end
    end
    snapshot.extras = setmetatable(extras, cjson.empty_array_mt)
    return snapshot
end

-- ---- What the buttons do ----

-- A whole number between low and high, or nil.
local function whole_number(value, low, high)
    value = tonumber(value)
    if not value or value % 1 ~= 0 or value < low or value > high then
        return nil
    end
    return value
end

-- Each action gets (user, body, today) and returns
--   ok, message[, extra]   ok = true when it worked,
--                          message = a short line for the panel's toast,
--                          extra = { reload = true } when the page should reload.
-- A nil result from database_query means the database failed.
local ACTIONS = {}

-- The usual ending of an action: done is what database_query returned.
local function ran(done, message, extra)
    if done == nil then
        return false
    end
    return true, message, extra
end

-- ---- You ----

ACTIONS.reset_onboarding = function(user)
    local done = database_query([[
        UPDATE public.auth_users SET profile_onboarding_seen = false WHERE id = $1
    ]], user.id)
    return ran(done, "Welcome flow is back", { reload = true })
end

ACTIONS.reset_look = function(user)
    local done = database_query([[
        UPDATE public.auth_users SET appearance = NULL, network_style = NULL WHERE id = $1
    ]], user.id)
    return ran(done, "Theme, fonts and network look reset", { reload = true })
end

-- ---- Goals ----

-- Moves the active goal to step "step" (0 = nothing done, the number of
-- steps = finished). Steps before it get a completion date (now) if they
-- had none; steps from it on lose theirs.
ACTIONS.set_step = function(user, body)
    local step = whole_number(body.step, 0, 100)
    if not step then
        return false, "Pick a step between 0 and 100"
    end
    local rows = database_query([[
        WITH goal AS (
            SELECT id, LEAST($2::int, jsonb_array_length(tree_data->'steps')) AS n
            FROM public.user_progress_trees
            WHERE user_id = $1 AND is_active AND tree_data IS NOT NULL
        ),
        removed AS (
            DELETE FROM public.step_completions s USING goal
            WHERE s.goal_id = goal.id AND s.step_index >= goal.n
        ),
        added AS (
            INSERT INTO public.step_completions (goal_id, user_id, step_index)
            SELECT goal.id, $1, i FROM goal, generate_series(0, goal.n - 1) AS i
            ON CONFLICT DO NOTHING
        )
        UPDATE public.user_progress_trees t
        SET completed_count = goal.n, updated_at = now()
        FROM goal WHERE t.id = goal.id
        RETURNING t.completed_count
    ]], user.id, step)
    if not rows then
        return false
    end
    if not rows[1] then
        return false, "No active goal with steps yet"
    end
    return true, "Now on step " .. (tonumber(rows[1].completed_count) + 1)
end

-- ---- Streak ----

-- Tap a day on the calendar strip: adds a check-in, or removes it.
ACTIONS.toggle_day = function(user, body, today)
    local day = body.day
    if not valid_checkin_day(day) then
        return false, "That is not a real date"
    end
    local rows = database_query([[
        WITH removed AS (
            DELETE FROM public.daily_checkins
            WHERE user_id = $1 AND day = $2::date
            RETURNING day
        ),
        added AS (
            INSERT INTO public.daily_checkins (user_id, goal_id, day, note)
            SELECT $1,
                   (SELECT id FROM public.user_progress_trees WHERE user_id = $1 AND is_active),
                   $2::date, 'Dev check-in'
            WHERE NOT EXISTS (SELECT 1 FROM removed)
              AND $2::date BETWEEN $3::date - 400 AND $3::date
            RETURNING day
        )
        SELECT (SELECT count(*) FROM removed) AS removed, (SELECT count(*) FROM added) AS added
    ]], user.id, day, today)
    if not rows then
        return false
    end
    if tonumber(rows[1].removed) > 0 then
        return true, day == today and "Today's check-in removed" or "Check-in removed"
    end
    if tonumber(rows[1].added) > 0 then
        return true, day == today and "Checked in today" or "Check-in added"
    end
    return false, "Only the last 400 days, up to today"
end

-- Makes the streak exactly "days" long, ending yesterday, so today's
-- check-in is still open to test. A few empty days before it make sure no
-- streak freeze can join it to an older streak. Older history is kept.
ACTIONS.set_streak = function(user, body, today)
    local days = whole_number(body.days, 0, 365)
    if not days then
        return false, "Pick 0 to 365 days"
    end
    local done = database_query([[
        WITH removed AS (
            DELETE FROM public.daily_checkins
            WHERE user_id = $1
              AND (day = $2::date OR day BETWEEN $2::date - $3::int - $4::int AND $2::date - $3::int - 1)
        )
        INSERT INTO public.daily_checkins (user_id, goal_id, day, note)
        SELECT $1,
               (SELECT id FROM public.user_progress_trees WHERE user_id = $1 AND is_active),
               $2::date - i, 'Dev check-in'
        FROM generate_series(1, $3::int) AS i
        ON CONFLICT (user_id, day) DO NOTHING
    ]], user.id, today, days, STREAK_BREAK_DAYS)
    return ran(done, days == 0 and "Streak broken" or ("Streak set to " .. days .. ", today open"))
end

-- Pretends a day passed with nothing done: every date of yours moves one
-- day back (check-ins, finished steps, and the waterings, side quests and
-- nudges of your shared trees). Today is then empty, yesterday holds what
-- today held.
--
-- Why the odd "far back, then forward again" moves: those tables allow one
-- row per day, and PostgreSQL checks that after every single row. Moving
-- everything one day at once could hit a day that is not moved away yet.
-- Moving 100000 days back first (nothing lives there) and then 99999 days
-- forward never meets an existing row. BEGIN/COMMIT make it all or
-- nothing. The user id is a number from our own database, so it can be
-- written into the SQL directly (several statements can't take $1).
ACTIONS.skip_day = function(user)
    local id = string.format("%d", user.id)
    local trees = "(SELECT id FROM public.shared_trees WHERE " .. id .. " IN (user_low, user_high))"
    local sql = { "BEGIN;" }
    for _, shift in ipairs({ "- 100000", "+ 99999" }) do
        sql[#sql + 1] = "UPDATE public.daily_checkins SET day = day " .. shift
            .. " WHERE user_id = " .. id .. ";"
        sql[#sql + 1] = "UPDATE public.shared_tree_waterings SET day = day " .. shift
            .. " WHERE tree_id IN " .. trees .. ";"
        sql[#sql + 1] = "UPDATE public.shared_tree_side_quests SET day = day " .. shift
            .. " WHERE tree_id IN " .. trees .. ";"
        sql[#sql + 1] = "UPDATE public.shared_tree_nudges SET day = day " .. shift
            .. " WHERE tree_id IN " .. trees .. ";"
    end
    sql[#sql + 1] = "UPDATE public.step_completions SET completed_at = completed_at - interval '1 day'"
        .. " WHERE user_id = " .. id .. ";"
    sql[#sql + 1] = "COMMIT;"
    return ran(database_query(table.concat(sql, "\n")), "A day went by")
end

ACTIONS.clear_checkins = function(user)
    local done = database_query([[
        DELETE FROM public.daily_checkins WHERE user_id = $1
    ]], user.id)
    return ran(done, "All check-ins removed")
end

-- ---- Weekly review ----

ACTIONS.clear_week_review = function(user, _, today)
    local done = database_query([[
        DELETE FROM public.weekly_reviews
        WHERE user_id = $1 AND week_start = date_trunc('week', $2::date)::date
    ]], user.id, today)
    return ran(done, "This week's review removed")
end

-- ---- Friends and shared trees ----

ACTIONS.clear_follows = function(user)
    local done = database_query([[
        DELETE FROM public.user_follows WHERE follower_id = $1 OR followed_id = $1
    ]], user.id)
    return ran(done, "Follows and requests cleared")
end

ACTIONS.clear_notifications = function(user)
    local done = database_query([[
        DELETE FROM public.user_notifications WHERE user_id = $1
    ]], user.id)
    return ran(done, "Notifications cleared")
end

ACTIONS.unread_notifications = function(user)
    local done = database_query([[
        UPDATE public.user_notifications SET read_at = NULL WHERE user_id = $1
    ]], user.id)
    return ran(done, "Notifications unread again")
end

ACTIONS.clear_activities = function(user)
    local done = database_query([[
        DELETE FROM public.community_activities WHERE actor_id = $1
    ]], user.id)
    return ran(done, "Community posts removed")
end

ACTIONS.unwater_today = function(user, _, today)
    local done = database_query([[
        DELETE FROM public.shared_tree_waterings WHERE user_id = $1 AND day = $2::date
    ]], user.id, today)
    return ran(done, "Today's waterings removed")
end

-- Grows every growing shared tree by "days": fills the most recent days
-- before today that are not watered by both of you yet, for both of you.
ACTIONS.grow_shared = function(user, body, today)
    local days = whole_number(body.days, 1, 60)
    if not days then
        return false, "Pick 1 to 60 days"
    end
    local done = database_query([[
        WITH trees AS (
            SELECT id, user_low, user_high FROM public.shared_trees
            WHERE status = 'growing' AND $1 IN (user_low, user_high)
        ),
        open_days AS (
            SELECT t.id, d::date AS day,
                   row_number() OVER (PARTITION BY t.id ORDER BY d DESC) AS n
            FROM trees t,
                 generate_series($2::date - 1, $2::date - 365, interval '-1 day') AS d
            WHERE (SELECT count(*) FROM public.shared_tree_waterings w
                   WHERE w.tree_id = t.id AND w.day = d::date) < 2
        )
        INSERT INTO public.shared_tree_waterings (tree_id, user_id, day, note)
        SELECT o.id, who.user_id, o.day, 'Dev watering'
        FROM open_days o
        JOIN trees t ON t.id = o.id
        CROSS JOIN LATERAL (VALUES (t.user_low), (t.user_high)) AS who(user_id)
        WHERE o.n <= $3::int
        ON CONFLICT DO NOTHING
    ]], user.id, today, days)
    return ran(done, "Shared trees grew " .. days .. (days == 1 and " day" or " days"))
end

ACTIONS.clear_shared_trees = function(user)
    local done = database_query([[
        DELETE FROM public.shared_trees WHERE $1 IN (user_low, user_high)
    ]], user.id)
    return ran(done, "Shared trees removed")
end

-- ---- Reminders ----

ACTIONS.reset_reminder = function(user)
    local done = database_query([[
        UPDATE public.push_subscriptions SET last_sent_day = NULL WHERE user_id = $1
    ]], user.id)
    return ran(done, "Reminder can send again today")
end

-- ---- The endpoint ----

function M.handle_dev()
    local user, database_error = current_user()
    if database_error then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Authentication is temporarily unavailable." })
    end
    if not user then
        return respond(ngx.HTTP_UNAUTHORIZED, { error = "Please sign in to continue." })
    end
    if not is_progress_debug_user(user) then
        return respond(ngx.HTTP_FORBIDDEN, { error = "Dev tools are not enabled for this account." })
    end

    local method = ngx.req.get_method()
    local body = {}
    if method == "GET" then
        body.today = ngx.req.get_uri_args().today
    elseif method == "POST" then
        body = read_json_body(4000)
        if type(body) ~= "table" or type(body.action) ~= "string" then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "A dev action is required." })
        end
    else
        return respond(ngx.HTTP_NOT_ALLOWED, { error = "Only GET and POST are supported." })
    end

    local today = body.today
    if not valid_checkin_day(today) then
        today = os.date("!%Y-%m-%d")
    end

    local result = { ok = true }
    if method == "POST" then
        local action = ACTIONS[body.action]
        if not action then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "Unknown dev action." })
        end
        ngx.log(ngx.NOTICE, "Dev tools: user ", user.id, " ran ", body.action)
        local ok, message, extra = action(user, body, today)
        if not ok then
            return respond(message and ngx.HTTP_BAD_REQUEST or ngx.HTTP_SERVICE_UNAVAILABLE, {
                error = message or "The database did not answer. Try again.",
            })
        end
        result.message = message
        result.reload = extra and extra.reload or nil
    end

    result.snapshot = load_snapshot(user, today)
    if not result.snapshot then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not load the dev snapshot." })
    end
    return respond(ngx.HTTP_OK, result)
end

-- Lets another module add its own card and buttons (see the comment at
-- the top): devtools.add_section(function(user, today) ... end) and
-- devtools.add_action("gems_add", function(user, body, today) ... end).
function M.add_section(section)
    EXTRA_SECTIONS[#EXTRA_SECTIONS + 1] = section
end

function M.add_action(name, action)
    ACTIONS[name] = action
end

return M
