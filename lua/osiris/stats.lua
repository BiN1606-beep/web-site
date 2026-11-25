-- The /api/stats endpoint: numbers about how people use Osiris, for the
-- owner's stats page (public/stats.html).
--
-- Only accounts listed in lua/debug_menu_email.txt (the same list as the
-- debug menu) can read it. It returns totals and counts only, never anyone's
-- email, notes or goals, so even the owner sees no private details.
--
-- "Active" means the person did something real that day: a daily check-in or
-- a finished step. Opening the page alone does not count.

local cjson = require "cjson.safe"
local M = {}
local common = require "osiris.common"
local goals = require "osiris.goals"

local respond = common.respond
local database_query = common.database_query
local current_user = common.current_user
local is_progress_debug_user = goals.is_progress_debug_user
local MAX_GOALS = goals.MAX_GOALS

-- One query that builds the whole answer as JSON inside PostgreSQL. Each
-- table is read once into a small summary (the WITH parts), and the 30-day
-- chart joins those summaries instead of counting again for every day.
local STATS_SQL = [[
WITH today AS (SELECT (now() AT TIME ZONE 'Europe/Stockholm')::date AS d),
users AS (
    SELECT id, (created_at AT TIME ZONE 'Europe/Stockholm')::date AS joined FROM public.auth_users
),
activity AS (
    SELECT user_id, day FROM public.daily_checkins
    UNION
    SELECT user_id, (completed_at AT TIME ZONE 'Europe/Stockholm')::date FROM public.step_completions
),
goals AS (
    SELECT user_id, completed_count,
           jsonb_array_length(COALESCE(tree_data->'steps', '[]'::jsonb)) AS total_steps
    FROM public.user_progress_trees
    WHERE tree_data IS NOT NULL
),
-- People who joined 14 to 42 days ago, and whether they were active in
-- their second week.
cohort AS (
    SELECT u.id, EXISTS (
        SELECT 1 FROM activity a
        WHERE a.user_id = u.id AND a.day >= u.joined + 7 AND a.day < u.joined + 14
    ) AS came_back
    FROM users u, today
    WHERE u.joined <= today.d - 14 AND u.joined > today.d - 42
),
days AS (
    SELECT generate_series(today.d - 29, today.d, interval '1 day')::date AS day FROM today
),
active_per_day AS (SELECT day, count(DISTINCT user_id) AS n FROM activity GROUP BY day),
signups_per_day AS (SELECT joined AS day, count(*) AS n FROM users GROUP BY joined)
SELECT json_build_object(
    'generated_at', now(),
    'members', (SELECT count(*) FROM users),
    'new_7d', (SELECT count(*) FROM users, today WHERE joined > today.d - 7),
    'active_today', (SELECT count(DISTINCT user_id) FROM activity, today WHERE day = today.d),
    'active_7d', (SELECT count(DISTINCT user_id) FROM activity, today WHERE day > today.d - 7),
    'active_30d', (SELECT count(DISTINCT user_id) FROM activity, today WHERE day > today.d - 30),
    'cohort', (SELECT count(*) FROM cohort),
    'came_back', (SELECT count(*) FROM cohort WHERE came_back),
    'made_goal', (SELECT count(DISTINCT user_id) FROM goals),
    'checked_in', (SELECT count(DISTINCT user_id) FROM public.daily_checkins),
    'finished_step', (SELECT count(DISTINCT user_id) FROM public.step_completions),
    'goals', (SELECT count(*) FROM goals),
    'goals_finished', (SELECT count(*) FROM goals WHERE total_steps > 0 AND completed_count >= total_steps),
    'at_limit', (SELECT count(*) FROM (SELECT 1 FROM goals GROUP BY user_id HAVING count(*) >= $1) g),
    'ai_today', (SELECT COALESCE(sum(request_count), 0) FROM public.groq_daily_usage WHERE usage_date = CURRENT_DATE),
    'daily', (
        SELECT json_agg(json_build_object(
            'day', days.day,
            'active', COALESCE(a.n, 0),
            'signups', COALESCE(s.n, 0),
            'ai', COALESCE(g.request_count, 0)
        ) ORDER BY days.day)
        FROM days
        LEFT JOIN active_per_day a ON a.day = days.day
        LEFT JOIN signups_per_day s ON s.day = days.day
        LEFT JOIN public.groq_daily_usage g ON g.usage_date = days.day
    )
)::text AS stats
]]

function M.handle_stats()
    if ngx.req.get_method() ~= "GET" then
        return respond(ngx.HTTP_NOT_ALLOWED, { error = "Only GET is supported." })
    end
    local user, database_error = current_user()
    if database_error then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Authentication is temporarily unavailable." })
    end
    if not user then
        return respond(ngx.HTTP_UNAUTHORIZED, { error = "Please sign in to continue." })
    end
    if not is_progress_debug_user(user) then
        return respond(ngx.HTTP_FORBIDDEN, { error = "Stats are only for the site owner." })
    end

    local rows = database_query(STATS_SQL, MAX_GOALS)
    local stats = rows and rows[1] and cjson.decode(rows[1].stats)
    if not stats then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not load the stats." })
    end
    return respond(ngx.HTTP_OK, { stats = stats, max_goals = MAX_GOALS })
end

return M
