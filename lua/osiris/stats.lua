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
-- part is a small sub-select, so it is easy to add or remove a number.
local STATS_SQL = [[
WITH activity AS (
    SELECT user_id, day FROM public.daily_checkins
    UNION
    SELECT user_id, (completed_at AT TIME ZONE 'Europe/Stockholm')::date FROM public.step_completions
),
today AS (SELECT (now() AT TIME ZONE 'Europe/Stockholm')::date AS d),
goals AS (
    SELECT user_id, completed_count, created_at,
           COALESCE(tree_data->>'area', 'Other') AS area,
           jsonb_array_length(COALESCE(tree_data->'steps', '[]'::jsonb)) AS total_steps
    FROM public.user_progress_trees
    WHERE tree_data IS NOT NULL
),
days AS (
    SELECT generate_series((SELECT d FROM today) - 29, (SELECT d FROM today), interval '1 day')::date AS day
),
signup_week AS (
    -- People who signed up 14 to 42 days ago: old enough to measure if they
    -- came back in their second week.
    SELECT id, (created_at AT TIME ZONE 'Europe/Stockholm')::date AS joined
    FROM public.auth_users
    WHERE created_at < now() - interval '14 days'
      AND created_at >= now() - interval '42 days'
)
SELECT json_build_object(
    'generated_at', now(),
    'users', json_build_object(
        'total', (SELECT count(*) FROM public.auth_users),
        'new_today', (SELECT count(*) FROM public.auth_users WHERE (created_at AT TIME ZONE 'Europe/Stockholm')::date = (SELECT d FROM today)),
        'new_7d', (SELECT count(*) FROM public.auth_users WHERE created_at >= now() - interval '7 days'),
        'new_30d', (SELECT count(*) FROM public.auth_users WHERE created_at >= now() - interval '30 days'),
        'google', (SELECT count(*) FROM public.auth_users WHERE google_sub IS NOT NULL)
    ),
    'active', json_build_object(
        'today', (SELECT count(DISTINCT user_id) FROM activity WHERE day = (SELECT d FROM today)),
        'last_7d', (SELECT count(DISTINCT user_id) FROM activity WHERE day > (SELECT d FROM today) - 7),
        'last_30d', (SELECT count(DISTINCT user_id) FROM activity WHERE day > (SELECT d FROM today) - 30)
    ),
    'funnel', json_build_object(
        'signed_up', (SELECT count(*) FROM public.auth_users),
        'made_goal', (SELECT count(DISTINCT user_id) FROM goals),
        'finished_step', (SELECT count(DISTINCT user_id) FROM public.step_completions),
        'checked_in', (SELECT count(DISTINCT user_id) FROM public.daily_checkins),
        'active_7d', (SELECT count(DISTINCT user_id) FROM activity WHERE day > (SELECT d FROM today) - 7)
    ),
    'retention', json_build_object(
        'cohort', (SELECT count(*) FROM signup_week),
        'came_back_week2', (
            SELECT count(DISTINCT s.id) FROM signup_week s
            JOIN activity a ON a.user_id = s.id
            WHERE a.day >= s.joined + 7 AND a.day < s.joined + 14
        )
    ),
    'goals', json_build_object(
        'total', (SELECT count(*) FROM goals),
        'finished', (SELECT count(*) FROM goals WHERE total_steps > 0 AND completed_count >= total_steps),
        'new_7d', (SELECT count(*) FROM goals WHERE created_at >= now() - interval '7 days'),
        'avg_per_user', (SELECT round(avg(n), 1) FROM (SELECT count(*) AS n FROM goals GROUP BY user_id) g),
        'at_limit', (SELECT count(*) FROM (SELECT user_id FROM goals GROUP BY user_id HAVING count(*) >= $1) g),
        'by_area', (SELECT COALESCE(json_object_agg(area, n), '{}'::json) FROM (SELECT area, count(*) AS n FROM goals GROUP BY area ORDER BY n DESC) a)
    ),
    'steps', json_build_object(
        'total', (SELECT count(*) FROM public.step_completions),
        'last_7d', (SELECT count(*) FROM public.step_completions WHERE completed_at >= now() - interval '7 days')
    ),
    'checkins', json_build_object(
        'total', (SELECT count(*) FROM public.daily_checkins),
        'last_7d', (SELECT count(*) FROM public.daily_checkins WHERE day > (SELECT d FROM today) - 7)
    ),
    'features', json_build_object(
        'reminders_on', (SELECT count(DISTINCT user_id) FROM public.push_subscriptions),
        'weekly_reviews', (SELECT count(*) FROM public.weekly_reviews),
        'weekly_review_users', (SELECT count(DISTINCT user_id) FROM public.weekly_reviews)
    ),
    'community', json_build_object(
        'friendships', (SELECT count(*) FROM public.user_friendships WHERE status = 'accepted'),
        'follows', (SELECT count(*) FROM public.user_follows),
        'reactions', (SELECT count(*) FROM public.community_reactions),
        'open_reports', (SELECT count(*) FROM public.user_reports WHERE status <> 'resolved')
    ),
    'ai', json_build_object(
        'today', (SELECT COALESCE(sum(request_count), 0) FROM public.groq_daily_usage WHERE usage_date = CURRENT_DATE),
        'last_30d', (SELECT COALESCE(sum(request_count), 0) FROM public.groq_daily_usage WHERE usage_date > CURRENT_DATE - 30)
    ),
    'daily', (
        SELECT json_agg(json_build_object(
            'day', days.day,
            'signups', (SELECT count(*) FROM public.auth_users u WHERE (u.created_at AT TIME ZONE 'Europe/Stockholm')::date = days.day),
            'active', (SELECT count(DISTINCT user_id) FROM activity a WHERE a.day = days.day),
            'checkins', (SELECT count(*) FROM public.daily_checkins c WHERE c.day = days.day),
            'steps', (SELECT count(*) FROM public.step_completions s WHERE (s.completed_at AT TIME ZONE 'Europe/Stockholm')::date = days.day),
            'ai', (SELECT COALESCE(sum(request_count), 0) FROM public.groq_daily_usage g WHERE g.usage_date = days.day)
        ) ORDER BY days.day)
        FROM days
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
