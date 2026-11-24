-- The /api/community endpoint: search, friends, follows, blocks, reports, the feed, reactions, notifications and profiles.
--
-- Part of the server code that auth.lua used to hold in one file. Each
-- module returns a table M with its functions; the names a module
-- borrows from another module are listed at the top.

local M = {}
local common = require "osiris.common"
local goals = require "osiris.goals"

local respond = common.respond
local database_query = common.database_query
local current_user = common.current_user
local read_json_body = common.read_json_body
local decode_json_value = common.decode_json_value
local progress_tree_view = goals.progress_tree_view
local load_goal_summaries = goals.load_goal_summaries
local load_step_completions = goals.load_step_completions

-- What a friend's profile shows of their network: every goal with its
-- finished steps and current step (as in the owner's own network), and
-- the days they checked in, for their streak and rewards. Check-in notes
-- stay private. Without show_goals the goal names are hidden.
local function friend_network(target_id, can_show_goal)
    local summaries = load_goal_summaries(target_id, load_step_completions(target_id))
    local days = database_query([[
        SELECT day::text AS day FROM public.daily_checkins
        WHERE user_id = $1
        ORDER BY day DESC
        LIMIT 400
    ]], target_id)
    if not summaries or not days then
        return nil
    end
    local network_goals = {}
    for index, goal in ipairs(summaries) do
        network_goals[#network_goals + 1] = {
            id = index,
            goal = can_show_goal and goal.goal or ("Goal " .. index),
            area = goal.area,
            completed = goal.completed,
            current_step = goal.current_step,
            total_steps = goal.total_steps,
            finished = goal.finished,
        }
    end
    local checkin_days = {}
    for _, row in ipairs(days) do
        checkin_days[#checkin_days + 1] = row.day
    end
    return { goals = network_goals, checkin_days = checkin_days }
end

-- A user (or activity) ID from the browser, as a number, or nil.
-- It must be a number, not text: newer pgmoon versions send Lua strings to
-- PostgreSQL typed as text, and "id = $1" with a text $1 then fails with
-- "operator does not exist: bigint = text". 15 digits keeps it exact in a
-- Lua number.
local function valid_social_user_id(value)
    if type(value) ~= "string" and type(value) ~= "number" then
        return nil
    end
    local id = tostring(value)
    if #id > 15 or not id:match("^[1-9]%d*$") then
        return nil
    end
    return tonumber(id)
end

local function ensure_social_settings(user_id)
    return database_query([[
        INSERT INTO public.user_social_settings (user_id)
        VALUES ($1)
        ON CONFLICT (user_id) DO NOTHING
        RETURNING user_id
    ]], user_id) ~= nil
end

local function social_person_rows(user_id, relation)
    local query
    if relation == "friends" then
        query = [[
            SELECT person.id, person.profile_username,
                COALESCE(NULLIF(person.profile_display_name, ''), person.profile_username) AS display_name,
                person.profile_picture, person.profile_bio,
                CASE WHEN COALESCE(settings.show_goals, false)
                    THEN person.profile_goals ELSE '' END AS profile_goals,
                EXISTS (SELECT 1 FROM public.user_follows f
                    WHERE f.follower_id = $1 AND f.followed_id = person.id) AS following
            FROM public.user_friendships friendship
            JOIN public.auth_users person
              ON person.id = CASE WHEN friendship.user_low = $1 THEN friendship.user_high ELSE friendship.user_low END
            LEFT JOIN public.user_social_settings settings ON settings.user_id = person.id
            WHERE (friendship.user_low = $1 OR friendship.user_high = $1)
              AND friendship.status = 'accepted'
            ORDER BY display_name, person.id
            LIMIT 100
        ]]
    elseif relation == "following" or relation == "followers" then
        local id_column = relation == "following" and "followed_id" or "follower_id"
        local filter_column = relation == "following" and "follower_id" or "followed_id"
        query = [[
            SELECT person.id, person.profile_username,
                COALESCE(NULLIF(person.profile_display_name, ''), person.profile_username) AS display_name,
                person.profile_picture,
                CASE WHEN COALESCE(settings.profile_visibility, 'private') = 'public'
                    THEN person.profile_bio ELSE '' END AS profile_bio,
                CASE WHEN COALESCE(settings.profile_visibility, 'private') = 'public'
                          AND COALESCE(settings.show_goals, false)
                    THEN person.profile_goals ELSE '' END AS profile_goals,
                EXISTS (SELECT 1 FROM public.user_follows f
                    WHERE f.follower_id = $1 AND f.followed_id = person.id) AS following
            FROM public.user_follows relation
            JOIN public.auth_users person ON person.id = relation.]] .. id_column .. [[
            LEFT JOIN public.user_social_settings settings ON settings.user_id = person.id
            WHERE relation.]] .. filter_column .. [=[ = $1
            ORDER BY display_name, person.id
            LIMIT 100
        ]=]
    else
        if relation == "blocked" then
            query = [[
                SELECT person.id, person.profile_username,
                    COALESCE(NULLIF(person.profile_display_name, ''), person.profile_username) AS display_name,
                    person.profile_picture, '' AS profile_bio, '' AS profile_goals,
                    false AS following
                FROM public.user_blocks blocks
                JOIN public.auth_users person ON person.id = blocks.blocked_id
                WHERE blocks.blocker_id = $1
                ORDER BY display_name, person.id
                LIMIT 100
            ]]
            return database_query(query, user_id)
        end
        local incoming = relation == "incoming"
        query = [[
            SELECT person.id, person.profile_username,
                COALESCE(NULLIF(person.profile_display_name, ''), person.profile_username) AS display_name,
                person.profile_picture, '' AS profile_bio, '' AS profile_goals,
                EXISTS (SELECT 1 FROM public.user_follows f
                    WHERE f.follower_id = $1 AND f.followed_id = person.id) AS following,
                friendship.status, friendship.requested_by
            FROM public.user_friendships friendship
            JOIN public.auth_users person
              ON person.id = CASE WHEN friendship.user_low = $1 THEN friendship.user_high ELSE friendship.user_low END
            WHERE (friendship.user_low = $1 OR friendship.user_high = $1)
              AND friendship.status = 'pending'
              AND friendship.requested_by ]] .. (incoming and "<>" or "=") .. [[ $1
            ORDER BY friendship.created_at DESC
            LIMIT 100
        ]]
    end
    return database_query(query, user_id)
end

local function database_boolean(value)
    return value == true or value == "t" or value == "true"
end

local function social_profile(user_id, target_id)
    local access = database_query([[
        SELECT target.id,
            COALESCE(settings.profile_visibility, 'private') = 'public'
                OR EXISTS (
                    SELECT 1 FROM public.user_friendships f
                    WHERE f.status = 'accepted'
                      AND ((f.user_low = $1 AND f.user_high = target.id)
                        OR (f.user_high = $1 AND f.user_low = target.id))
                ) AS can_view,
            EXISTS (SELECT 1 FROM public.user_follows f
                WHERE f.follower_id = $1 AND f.followed_id = target.id) AS following,
            friendship.status AS friendship_status,
            friendship.requested_by,
            COALESCE(settings.show_goals, false) AS show_goals,
            COALESCE(settings.show_progress, false) AS show_progress
        FROM public.auth_users target
        LEFT JOIN public.user_social_settings settings ON settings.user_id = target.id
        LEFT JOIN public.user_friendships friendship
          ON friendship.user_low = LEAST($1::bigint, target.id)
         AND friendship.user_high = GREATEST($1::bigint, target.id)
        WHERE target.id = $2
          AND target.id <> $1
          AND NOT EXISTS (
              SELECT 1 FROM public.user_blocks b
              WHERE (b.blocker_id = $1 AND b.blocked_id = target.id)
                 OR (b.blocker_id = target.id AND b.blocked_id = $1)
          )
    ]], user_id, target_id)
    if not access then
        return nil, "database"
    end
    if not access[1] then
        return nil, "missing"
    end
    if not database_boolean(access[1].can_view) then
        return nil, "private"
    end
    local rows = database_query([[
        SELECT person.id, person.profile_username,
            COALESCE(NULLIF(person.profile_display_name, ''), person.profile_username) AS display_name,
            person.profile_picture, person.profile_bio, person.profile_gender,
            person.profile_goals
        FROM public.auth_users person
        WHERE person.id = $1
    ]], target_id)
    if not rows or not rows[1] then
        return nil, "database"
    end
    local person = rows[1]
    local count_rows = database_query([[
        SELECT
            (SELECT count(*) FROM public.user_friendships f
             WHERE f.status = 'accepted'
               AND (f.user_low = $1 OR f.user_high = $1)) AS friend_count,
            (SELECT count(*) FROM public.user_follows f WHERE f.followed_id = $1) AS follower_count,
            (SELECT count(*) FROM public.user_follows f WHERE f.follower_id = $1) AS following_count
    ]], target_id)
    if not count_rows or not count_rows[1] then
        return nil, "database"
    end
    local result = {
        id = person.id,
        username = person.profile_username,
        display_name = person.display_name,
        picture = person.profile_picture,
        bio = person.profile_bio,
        goal = database_boolean(access[1].show_goals) and person.profile_goals or "",
        friend_count = tonumber(count_rows[1].friend_count) or 0,
        follower_count = tonumber(count_rows[1].follower_count) or 0,
        following_count = tonumber(count_rows[1].following_count) or 0,
        following = database_boolean(access[1].following),
        friend_status = access[1].friendship_status or "none",
        friend_requested_by = access[1].requested_by,
    }
    if database_boolean(access[1].show_progress) then
        local tree_rows = database_query([[
            SELECT id, tree_data, completed_count, conversation, ai_memory
            FROM public.user_progress_trees
            WHERE user_id = $1 AND is_active
        ]], target_id)
        if not tree_rows then
            return nil, "database"
        end
        if tree_rows[1] and decode_json_value(tree_rows[1].tree_data, nil) then
            local tree = progress_tree_view(tree_rows[1])
            local can_show_goal = database_boolean(access[1].show_goals)
            result.progress = {
                exists = tree.exists,
                goal = can_show_goal and tree.goal or "Progress journey",
                summary = can_show_goal and tree.summary or "",
                completed_count = tree.completed_count,
                total_steps = tree.total_steps,
                progress = tree.progress,
                completed = tree.completed,
                current_step = tree.current_step and {
                    title = tree.current_step.title,
                    description = tree.current_step.description,
                    why = tree.current_step.why,
                    tip = tree.current_step.tip,
                } or nil,
                finished = tree.finished,
            }
        end
        -- A failed load only leaves out the network; the rest still shows.
        result.network = friend_network(target_id, database_boolean(access[1].show_goals))
    end
    return result
end

local function handle_community()
    local user, database_error = current_user()
    if database_error then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Authentication is temporarily unavailable." })
    end
    if not user then
        return respond(ngx.HTTP_UNAUTHORIZED, { error = "Please sign in to continue." })
    end
    if not ensure_social_settings(user.id) then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not load your community settings." })
    end

    local method = ngx.req.get_method()
    local args = ngx.req.get_uri_args()
    if method == "GET" then
        local action = args.action or "summary"
        if action == "search" then
            local query = type(args.q) == "string" and args.q:match("^%s*(.-)%s*$") or ""
            if #query < 2 or #query > 320 then
                return respond(ngx.HTTP_OK, { people = {} })
            end
            local id_query = query:match("^#?(%d+)$")
            local rows = database_query([[
                SELECT person.id, person.profile_username,
                    COALESCE(NULLIF(person.profile_display_name, ''), person.profile_username) AS display_name,
                    person.profile_picture,
                    CASE WHEN COALESCE(settings.profile_visibility, 'private') = 'public'
                        THEN person.profile_bio ELSE '' END AS bio,
                    CASE WHEN COALESCE(settings.profile_visibility, 'private') = 'public'
                              AND COALESCE(settings.show_goals, false)
                        THEN person.profile_goals ELSE '' END AS goals,
                    EXISTS (SELECT 1 FROM public.user_follows f
                        WHERE f.follower_id = $1 AND f.followed_id = person.id) AS following,
                    COALESCE(friendship.status, 'none') AS friend_status,
                    friendship.requested_by
                FROM public.auth_users person
                LEFT JOIN public.user_social_settings settings ON settings.user_id = person.id
                LEFT JOIN public.user_friendships friendship
                  ON friendship.user_low = LEAST($1::bigint, person.id)
                 AND friendship.user_high = GREATEST($1::bigint, person.id)
                WHERE person.id <> $1
                  AND COALESCE(settings.show_in_search, true)
                  AND NOT EXISTS (
                      SELECT 1 FROM public.user_blocks b
                      WHERE (b.blocker_id = $1 AND b.blocked_id = person.id)
                         OR (b.blocker_id = person.id AND b.blocked_id = $1)
                  )
                  AND (
                      ($2::text <> '' AND (
                          person.profile_username ILIKE '%' || $2 || '%'
                          OR COALESCE(person.profile_display_name, '') ILIKE '%' || $2 || '%'
                          OR lower(person.email) = lower($2)
                      ))
                      OR ($3::text <> '' AND person.id::text = $3)
                  )
                ORDER BY CASE
                             WHEN lower(person.email) = lower($2) THEN 0
                             WHEN person.profile_username ILIKE $2 || '%' THEN 1
                             ELSE 2
                         END,
                         display_name, person.id
                LIMIT 20
            ]], user.id, query:gsub("^@", ""), id_query or "")
            if not rows then
                return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not search community members." })
            end
            return respond(ngx.HTTP_OK, { people = rows })
        elseif action == "profile" then
            local target_id = valid_social_user_id(args.userId)
            if not target_id then
                return respond(ngx.HTTP_BAD_REQUEST, { error = "A valid user ID is required." })
            end
            local profile, reason = social_profile(user.id, target_id)
            if reason == "database" then
                return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not load that profile." })
            elseif reason == "private" then
                return respond(ngx.HTTP_FORBIDDEN, { error = "This profile is private." })
            elseif reason == "missing" then
                return respond(ngx.HTTP_NOT_FOUND, { error = "That profile is unavailable." })
            end
            return respond(ngx.HTTP_OK, { profile = profile })
        elseif action == "notifications" then
            local rows = database_query([[
                SELECT notification.id, notification.notification_type, notification.created_at,
                    notification.read_at,
                    actor.id AS actor_id,
                    COALESCE(NULLIF(actor.profile_display_name, ''), actor.profile_username, 'A member') AS actor_name,
                    actor.profile_username, actor.profile_picture
                FROM public.user_notifications notification
                LEFT JOIN public.auth_users actor ON actor.id = notification.actor_id
                WHERE notification.user_id = $1
                ORDER BY notification.created_at DESC, notification.id DESC
                LIMIT 50
            ]], user.id)
            if not rows then
                return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not load notifications." })
            end
            return respond(ngx.HTTP_OK, { notifications = rows })
        elseif action == "feed" then
            local rows = database_query([[
                SELECT activity.id, activity.activity_type,
                    CASE WHEN settings.show_progress THEN activity.details ELSE '{}'::jsonb END AS details,
                    activity.created_at,
                    actor.id AS actor_id,
                    COALESCE(NULLIF(actor.profile_display_name, ''), actor.profile_username) AS actor_name,
                    actor.profile_username, actor.profile_picture,
                    COALESCE((SELECT jsonb_object_agg(reaction, count) FROM (
                        SELECT reaction, count(*) AS count
                        FROM public.community_reactions
                        WHERE activity_id = activity.id
                        GROUP BY reaction
                    ) counts), '{}'::jsonb) AS reactions,
                    (SELECT reaction FROM public.community_reactions
                     WHERE activity_id = activity.id AND user_id = $1) AS my_reaction
                FROM public.community_activities activity
                JOIN public.auth_users actor ON actor.id = activity.actor_id
                JOIN public.user_social_settings settings ON settings.user_id = actor.id
                WHERE actor.id <> $1
                  AND settings.show_activity
                  AND (
                    EXISTS (SELECT 1 FROM public.user_follows f
                        WHERE f.follower_id = $1 AND f.followed_id = actor.id)
                    OR EXISTS (SELECT 1 FROM public.user_friendships friendship
                        WHERE friendship.status = 'accepted'
                          AND ((friendship.user_low = $1 AND friendship.user_high = actor.id)
                            OR (friendship.user_high = $1 AND friendship.user_low = actor.id)))
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM public.user_blocks b
                      WHERE (b.blocker_id = $1 AND b.blocked_id = actor.id)
                         OR (b.blocker_id = actor.id AND b.blocked_id = $1)
                  )
                ORDER BY activity.created_at DESC, activity.id DESC
                LIMIT 50
            ]], user.id)
            if not rows then
                return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not load the activity feed." })
            end
            return respond(ngx.HTTP_OK, { activities = rows })
        elseif action == "summary" then
            local incoming = social_person_rows(user.id, "incoming")
            local outgoing = social_person_rows(user.id, "outgoing")
            local friends = social_person_rows(user.id, "friends")
            local following = social_person_rows(user.id, "following")
            local followers = social_person_rows(user.id, "followers")
            local blocked = social_person_rows(user.id, "blocked")
            local settings = database_query([[
                SELECT profile_visibility, show_goals, show_progress, show_activity,
                    allow_friend_requests, show_in_search
                FROM public.user_social_settings WHERE user_id = $1
            ]], user.id)
            local counts = database_query([[
                SELECT count(*) FILTER (WHERE read_at IS NULL) AS unread
                FROM public.user_notifications WHERE user_id = $1
            ]], user.id)
            if not incoming or not outgoing or not friends or not following or not followers or not blocked
                or not settings or not settings[1] or not counts or not counts[1] then
                return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not load your community." })
            end
            return respond(ngx.HTTP_OK, {
                user_id = user.id,
                incoming = incoming,
                outgoing = outgoing,
                friends = friends,
                following = following,
                followers = followers,
                blocked = blocked,
                settings = settings[1],
                unread = tonumber(counts[1].unread) or 0,
            })
        end
        return respond(ngx.HTTP_BAD_REQUEST, { error = "Unknown community view." })
    end

    if method ~= "POST" then
        return respond(ngx.HTTP_NOT_ALLOWED, { error = "Only GET and POST are supported." })
    end
    local body = read_json_body(12000)
    if not body or type(body.action) ~= "string" then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "A community action is required." })
    end
    local action = body.action
    local target_id = valid_social_user_id(body.userId)

    if action == "privacy" then
        local settings = body.settings
        if type(settings) ~= "table"
            or (settings.profile_visibility ~= "public" and settings.profile_visibility ~= "private")
            or type(settings.show_goals) ~= "boolean"
            or type(settings.show_progress) ~= "boolean"
            or type(settings.show_activity) ~= "boolean"
            or type(settings.allow_friend_requests) ~= "boolean"
            or type(settings.show_in_search) ~= "boolean" then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "Check your community privacy settings." })
        end
        local rows = database_query([[
            UPDATE public.user_social_settings
            SET profile_visibility = $2, show_goals = $3, show_progress = $4,
                show_activity = $5, allow_friend_requests = $6, show_in_search = $7,
                updated_at = now()
            WHERE user_id = $1
            RETURNING profile_visibility, show_goals, show_progress, show_activity,
                allow_friend_requests, show_in_search
        ]], user.id, settings.profile_visibility, settings.show_goals, settings.show_progress,
            settings.show_activity, settings.allow_friend_requests, settings.show_in_search)
        if not rows or not rows[1] then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not save your privacy settings." })
        end
        return respond(ngx.HTTP_OK, { settings = rows[1] })
    elseif action == "mark_read" then
        local rows = database_query([[
            UPDATE public.user_notifications SET read_at = now()
            WHERE user_id = $1 AND read_at IS NULL
            RETURNING id
        ]], user.id)
        if not rows then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not mark notifications as read." })
        end
        return respond(ngx.HTTP_OK, { ok = true })
    elseif action == "request" then
        if not target_id or target_id == tonumber(user.id) then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "Choose another community member." })
        end
        local rows = database_query([[
            WITH permitted AS (
                SELECT target.id FROM public.auth_users target
                JOIN public.user_social_settings settings ON settings.user_id = target.id
                WHERE target.id = $2 AND settings.allow_friend_requests
                  AND NOT EXISTS (
                      SELECT 1 FROM public.user_blocks b
                      WHERE (b.blocker_id = $1 AND b.blocked_id = target.id)
                         OR (b.blocker_id = target.id AND b.blocked_id = $1)
                  )
            ),
            changed AS (
                INSERT INTO public.user_friendships AS existing (user_low, user_high, requested_by, status)
                SELECT LEAST($1::bigint, permitted.id), GREATEST($1::bigint, permitted.id), $1, 'pending'
                FROM permitted
                ON CONFLICT (user_low, user_high) DO UPDATE
                    SET requested_by = EXCLUDED.requested_by, status = 'pending', updated_at = now()
                    WHERE existing.status = 'declined'
                RETURNING user_low
            ),
            notified AS (
                INSERT INTO public.user_notifications (user_id, actor_id, notification_type)
                SELECT $2, $1, 'friend_request' FROM changed
                RETURNING id
            )
            SELECT user_low FROM changed
        ]], user.id, target_id)
        if not rows then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not send the friend request." })
        end
        if not rows[1] then
            return respond(ngx.HTTP_CONFLICT, { error = "A request already exists, friend requests are disabled, or this profile is unavailable." })
        end
        return respond(ngx.HTTP_OK, { ok = true, status = "pending" })
    elseif action == "accept" or action == "decline" then
        if not target_id then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "A valid request sender is required." })
        end
        local accepted = action == "accept"
        local sql = accepted and [[
            WITH changed AS (
                UPDATE public.user_friendships
                SET status = 'accepted', updated_at = now()
                WHERE user_low = LEAST($1::bigint, $2::bigint)
                  AND user_high = GREATEST($1::bigint, $2::bigint)
                  AND requested_by = $2 AND status = 'pending'
                RETURNING requested_by
            ),
            notified AS (
                INSERT INTO public.user_notifications (user_id, actor_id, notification_type)
                SELECT $2, $1, 'friend_accepted' FROM changed
                RETURNING id
            )
            SELECT requested_by FROM changed
        ]] or [[
            UPDATE public.user_friendships
            SET status = 'declined', updated_at = now()
            WHERE user_low = LEAST($1::bigint, $2::bigint)
              AND user_high = GREATEST($1::bigint, $2::bigint)
              AND requested_by = $2 AND status = 'pending'
            RETURNING requested_by
        ]]
        local rows = database_query(sql, user.id, target_id)
        if not rows then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not update the friend request." })
        end
        if not rows[1] then
            return respond(ngx.HTTP_CONFLICT, { error = "That friend request is no longer available." })
        end
        return respond(ngx.HTTP_OK, { ok = true })
    elseif action == "cancel" or action == "remove_friend" then
        if not target_id then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "A valid user ID is required." })
        end
        local status = action == "cancel" and "pending" or "accepted"
        local rows = database_query([[
            DELETE FROM public.user_friendships
            WHERE user_low = LEAST($1::bigint, $2::bigint)
              AND user_high = GREATEST($1::bigint, $2::bigint)
              AND requested_by = CASE WHEN $3 = 'pending' THEN $1 ELSE requested_by END
              AND status = $3
            RETURNING user_low
        ]], user.id, target_id, status)
        if not rows then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not update that friendship." })
        end
        return respond(ngx.HTTP_OK, { ok = true })
    elseif action == "follow" or action == "unfollow" then
        if not target_id or target_id == tonumber(user.id) then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "Choose another community member." })
        end
        if action == "follow" then
            local rows = database_query([[
                WITH changed AS (
                    INSERT INTO public.user_follows (follower_id, followed_id)
                    SELECT $1, target.id
                    FROM public.auth_users target
                    WHERE target.id = $2
                      AND NOT EXISTS (
                          SELECT 1 FROM public.user_blocks b
                          WHERE (b.blocker_id = $1 AND b.blocked_id = target.id)
                             OR (b.blocker_id = target.id AND b.blocked_id = $1)
                      )
                    ON CONFLICT (follower_id, followed_id) DO NOTHING
                    RETURNING followed_id
                ),
                notified AS (
                    INSERT INTO public.user_notifications (user_id, actor_id, notification_type)
                    SELECT followed_id, $1, 'new_follower' FROM changed
                    RETURNING id
                )
                SELECT followed_id FROM changed
            ]], user.id, target_id)
            if not rows then
                return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not follow that member." })
            end
            if not rows[1] then
                return respond(ngx.HTTP_CONFLICT, { error = "That member is unavailable or already followed." })
            end
        else
            local rows = database_query([[
                DELETE FROM public.user_follows
                WHERE follower_id = $1 AND followed_id = $2
                RETURNING followed_id
            ]], user.id, target_id)
            if not rows then
                return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not unfollow that member." })
            end
        end
        return respond(ngx.HTTP_OK, { ok = true, following = action == "follow" })
    elseif action == "block" or action == "unblock" then
        if not target_id or target_id == tonumber(user.id) then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "Choose another community member." })
        end
        local rows
        if action == "block" then
            rows = database_query([[
                WITH target AS (
                    SELECT id FROM public.auth_users WHERE id = $2
                ),
                blocked AS (
                    INSERT INTO public.user_blocks (blocker_id, blocked_id)
                    SELECT $1, id FROM target
                    ON CONFLICT DO NOTHING
                    RETURNING blocked_id
                ),
                friendships AS (
                    DELETE FROM public.user_friendships
                    WHERE user_low = LEAST($1::bigint, $2::bigint)
                      AND user_high = GREATEST($1::bigint, $2::bigint)
                    RETURNING user_low
                ),
                follows AS (
                    DELETE FROM public.user_follows
                    WHERE (follower_id = $1 AND followed_id = $2)
                       OR (follower_id = $2 AND followed_id = $1)
                    RETURNING follower_id
                )
                SELECT id FROM target
            ]], user.id, target_id)
        else
            rows = database_query([[
                DELETE FROM public.user_blocks WHERE blocker_id = $1 AND blocked_id = $2
                RETURNING blocked_id
            ]], user.id, target_id)
        end
        if not rows then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not update your block list." })
        end
        return respond(ngx.HTTP_OK, { ok = true })
    elseif action == "report" then
        if not target_id or target_id == tonumber(user.id)
            or type(body.reason) ~= "string" or #body.reason < 1 or #body.reason > 1000 then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "Choose a member and provide a short report reason." })
        end
        local rows = database_query([[
            INSERT INTO public.user_reports (reporter_id, reported_id, reason)
            SELECT $1, id, $3 FROM public.auth_users WHERE id = $2
            RETURNING id
        ]], user.id, target_id, body.reason)
        if not rows then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not submit your report." })
        end
        if not rows[1] then
            return respond(ngx.HTTP_NOT_FOUND, { error = "That member is unavailable." })
        end
        return respond(ngx.HTTP_CREATED, { ok = true })
    elseif action == "react" then
        local activity_id = valid_social_user_id(body.activityId)
        local reaction = body.reaction
        if not activity_id or (reaction ~= "like" and reaction ~= "celebrate" and reaction ~= "support") then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "Choose a valid activity and reaction." })
        end
        local rows = database_query([[
            WITH visible AS (
                SELECT activity.id, activity.actor_id
                FROM public.community_activities activity
                JOIN public.user_social_settings settings ON settings.user_id = activity.actor_id
                WHERE activity.id = $2 AND settings.show_activity
                  AND activity.actor_id <> $1
                  AND (
                    EXISTS (SELECT 1 FROM public.user_follows f
                        WHERE f.follower_id = $1 AND f.followed_id = activity.actor_id)
                    OR EXISTS (SELECT 1 FROM public.user_friendships friendship
                        WHERE friendship.status = 'accepted'
                          AND ((friendship.user_low = $1 AND friendship.user_high = activity.actor_id)
                            OR (friendship.user_high = $1 AND friendship.user_low = activity.actor_id)))
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM public.user_blocks b
                    WHERE (b.blocker_id = $1 AND b.blocked_id = activity.actor_id)
                       OR (b.blocker_id = activity.actor_id AND b.blocked_id = $1)
                  )
            ),
            changed AS (
                INSERT INTO public.community_reactions (activity_id, user_id, reaction)
                SELECT id, $1, $3 FROM visible
                ON CONFLICT (activity_id, user_id) DO UPDATE
                    SET reaction = EXCLUDED.reaction, created_at = now()
                RETURNING activity_id
            ),
            notified AS (
                INSERT INTO public.user_notifications (user_id, actor_id, notification_type, activity_id)
                SELECT visible.actor_id, $1, 'reaction', changed.activity_id
                FROM changed JOIN visible ON visible.id = changed.activity_id
                ON CONFLICT (user_id, actor_id, notification_type, activity_id)
                    WHERE notification_type = 'reaction' DO NOTHING
                RETURNING id
            )
            SELECT activity_id FROM changed
        ]], user.id, activity_id, reaction)
        if not rows then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not react to that activity." })
        end
        if not rows[1] then
            return respond(ngx.HTTP_NOT_FOUND, { error = "That activity is unavailable." })
        end
        return respond(ngx.HTTP_OK, { ok = true, reaction = reaction })
    end
    return respond(ngx.HTTP_BAD_REQUEST, { error = "Unknown community action." })
end

M.valid_social_user_id = valid_social_user_id
M.ensure_social_settings = ensure_social_settings
M.social_person_rows = social_person_rows
M.database_boolean = database_boolean
M.social_profile = social_profile
M.handle_community = handle_community

return M
