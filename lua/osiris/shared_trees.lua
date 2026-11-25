-- Shared trees: two friends (people who follow each other) grow one tree
-- together. Each of them waters it once a day with a short line about what
-- they did, and the tree only grows on the days BOTH of them watered it.
-- A day where only one of you shows up does nothing, so you pull each
-- other along.
--
-- The /api/community endpoint (community.lua) hands its tree actions to
-- this module: GET ?action=trees, and POST tree_plant, tree_accept,
-- tree_remove, tree_water, tree_nudge and tree_side_quest.

local M = {}
local common = require "osiris.common"
local goals = require "osiris.goals"

local respond = common.respond
local database_query = common.database_query
local utf8_character_count = common.utf8_character_count
local valid_checkin_day = goals.valid_checkin_day

-- Trims a text from the browser and checks its length in characters.
-- Returns the trimmed text, or nil when it is missing, empty or too long.
local function short_text(value, max_length)
    if type(value) ~= "string" then
        return nil
    end
    local text = value:match("^%s*(.-)%s*$")
    local length = utf8_character_count(text)
    if not length or length < 1 or length > max_length then
        return nil
    end
    return text
end

-- A tree ID from the browser as a number (see valid_social_user_id in
-- community.lua for why it must be a number).
local function valid_tree_id(value)
    if type(value) ~= "string" and type(value) ~= "number" then
        return nil
    end
    local id = tostring(value)
    if #id > 15 or not id:match("^[1-9]%d*$") then
        return nil
    end
    return tonumber(id)
end

-- Small side quests that save the streak when your friend doesn't show up.
-- Easy on purpose: a minute or two. Which one you get depends on the goal
-- and the day, so it changes every day and both of you see the same one.
local SIDE_QUESTS = {
    "Do 10 squats",
    "Drink a big glass of water",
    "Take a 5-minute walk",
    "Read 2 pages of a book",
    "Tidy your desk for 3 minutes",
    "Stretch for 2 minutes",
    "Write down one thing you're grateful for",
    "Do 10 push-ups (knees are fine)",
    "Put your phone away for 15 minutes",
    "Plan tomorrow in 3 bullet points",
    "Take 10 slow, deep breaths",
    "Send someone a kind message",
}

-- The side quest for a goal on a day ("YYYY-MM-DD").
local function side_quest_for(tree_id, day)
    local year, month, date = day:match("^(%d+)%-(%d+)%-(%d+)$")
    local number = tonumber(year) * 372 + tonumber(month) * 31 + tonumber(date) + tonumber(tree_id) * 7
    return SIDE_QUESTS[number % #SIDE_QUESTS + 1]
end

-- Every tree you are part of that has not been removed, with your friend,
-- how big it has grown, and the last 60 days of waterings (who watered,
-- and what they wrote). "today" is the browser's own date, so the "did we
-- both water today?" answer follows the user's clock.
function M.list_trees(user_id, today)
    if not valid_checkin_day(today) then
        today = os.date("!%Y-%m-%d")
    end
    local rows = database_query([[
        SELECT tree.id, tree.title, tree.status, tree.planted_by = $1 AS planted_by_me,
            tree.created_at, tree.started_at,
            partner.id AS partner_id, partner.profile_username AS partner_username,
            COALESCE(NULLIF(partner.profile_display_name, ''), partner.profile_username) AS partner_name,
            partner.profile_picture AS partner_picture,
            EXISTS (SELECT 1 FROM public.user_friends friend
                WHERE friend.user_id = $1 AND friend.friend_id = partner.id) AS still_friends,
            -- How big it is: the days that have a watering from both.
            (SELECT count(*) FROM public.shared_tree_waterings mine
             JOIN public.shared_tree_waterings theirs
               ON theirs.tree_id = mine.tree_id AND theirs.day = mine.day
              AND theirs.user_id = partner.id
             WHERE mine.tree_id = tree.id AND mine.user_id = $1) AS grown,
            EXISTS (SELECT 1 FROM public.shared_tree_nudges nudge
                WHERE nudge.tree_id = tree.id AND nudge.from_user = $1
                  AND nudge.day = $2::date) AS nudged_today,
            COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'day', day_rows.day::text,
                    'me', day_rows.my_note,
                    'partner', day_rows.partner_note,
                    'saved', (SELECT CASE WHEN quest.user_id = $1 THEN 'me' ELSE 'partner' END
                        FROM public.shared_tree_side_quests quest
                        WHERE quest.tree_id = tree.id AND quest.day = day_rows.day),
                    'quest', (SELECT quest.quest FROM public.shared_tree_side_quests quest
                        WHERE quest.tree_id = tree.id AND quest.day = day_rows.day)
                ) ORDER BY day_rows.day DESC)
                FROM (
                    SELECT watering.day,
                        max(watering.note) FILTER (WHERE watering.user_id = $1) AS my_note,
                        max(watering.note) FILTER (WHERE watering.user_id <> $1) AS partner_note
                    FROM public.shared_tree_waterings watering
                    WHERE watering.tree_id = tree.id
                      AND watering.day > $2::date - 60
                    GROUP BY watering.day
                ) day_rows
            ), '[]'::jsonb) AS days
        FROM public.shared_trees tree
        JOIN public.auth_users partner
          ON partner.id = CASE WHEN tree.user_low = $1 THEN tree.user_high ELSE tree.user_low END
        WHERE (tree.user_low = $1 OR tree.user_high = $1)
          AND tree.status <> 'ended'
        ORDER BY tree.status = 'invited' DESC, tree.started_at DESC NULLS LAST, tree.id DESC
    ]], user_id, today)
    if not rows then
        return nil
    end
    for _, row in ipairs(rows) do
        row.grown = tonumber(row.grown) or 0
        row.days = common.decode_json_value(row.days, {})
        row.today = today
        row.side_quest = side_quest_for(row.id, today)
    end
    return rows
end

local function handle_plant(user, body)
    local partner_id = valid_tree_id(body.userId)
    local title = short_text(body.title, 80)
    if not partner_id or partner_id == tonumber(user.id) or not title then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "Pick a friend and give your tree a name." })
    end
    -- Only friends can plant together: the friends view only has a row
    -- when you follow each other.
    local rows = database_query([[
        WITH friend AS (
            SELECT friend_id FROM public.user_friends
            WHERE user_id = $1 AND friend_id = $2
        ),
        planted AS (
            INSERT INTO public.shared_trees (user_low, user_high, planted_by, title)
            SELECT LEAST($1::bigint, friend_id), GREATEST($1::bigint, friend_id), $1, $3
            FROM friend
            ON CONFLICT (user_low, user_high) WHERE status <> 'ended' DO NOTHING
            RETURNING id
        ),
        notified AS (
            INSERT INTO public.user_notifications (user_id, actor_id, notification_type)
            SELECT $2, $1, 'tree_invite' FROM planted
            RETURNING id
        )
        SELECT (SELECT id FROM planted) AS id, EXISTS (SELECT 1 FROM friend) AS friends
    ]], user.id, partner_id, title)
    if not rows or not rows[1] then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not plant the tree." })
    end
    local friends = rows[1].friends == true or rows[1].friends == "t"
    if not friends then
        return respond(ngx.HTTP_CONFLICT, { error = "Follow each other first, then you can grow a tree together." })
    end
    if not rows[1].id or rows[1].id == ngx.null then
        return respond(ngx.HTTP_CONFLICT, { error = "You already have a tree with this friend." })
    end
    return respond(ngx.HTTP_CREATED, { ok = true, id = rows[1].id })
end

local function handle_accept(user, tree_id)
    local rows = database_query([[
        WITH changed AS (
            UPDATE public.shared_trees tree
            SET status = 'growing', started_at = now()
            WHERE tree.id = $2 AND tree.status = 'invited'
              AND tree.planted_by <> $1
              AND (tree.user_low = $1 OR tree.user_high = $1)
              AND EXISTS (SELECT 1 FROM public.user_friends friend
                  WHERE friend.user_id = $1 AND friend.friend_id = tree.planted_by)
            RETURNING tree.id, tree.planted_by
        ),
        notified AS (
            INSERT INTO public.user_notifications (user_id, actor_id, notification_type)
            SELECT planted_by, $1, 'tree_started' FROM changed
            RETURNING id
        )
        SELECT id FROM changed
    ]], user.id, tree_id)
    if not rows then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not start the tree." })
    end
    if not rows[1] then
        return respond(ngx.HTTP_CONFLICT, { error = "This invite is no longer open. You need to follow each other to start it." })
    end
    return respond(ngx.HTTP_OK, { ok = true })
end

-- Removing an invite deletes it; removing a growing tree only ends it, so
-- the waterings are kept with it.
local function handle_remove(user, tree_id)
    local rows = database_query([[
        WITH removed_invite AS (
            DELETE FROM public.shared_trees
            WHERE id = $2 AND status = 'invited' AND (user_low = $1 OR user_high = $1)
            RETURNING id
        ),
        ended AS (
            UPDATE public.shared_trees
            SET status = 'ended', ended_at = now()
            WHERE id = $2 AND status = 'growing' AND (user_low = $1 OR user_high = $1)
            RETURNING id
        )
        SELECT id FROM removed_invite UNION ALL SELECT id FROM ended
    ]], user.id, tree_id)
    if not rows then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not remove the tree." })
    end
    return respond(ngx.HTTP_OK, { ok = true })
end

local function handle_water(user, tree_id, body)
    local note = short_text(body.note, 200)
    if not note then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "Write one line (up to 200 characters) about what you did today." })
    end
    if not valid_checkin_day(body.day) then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "A valid day is required." })
    end
    -- The day must be close to today (like check-ins), the tree must be
    -- growing, and you must still follow each other. Watering again on the
    -- same day only changes your line. xmax = 0 is PostgreSQL's way of
    -- telling a new row from an updated one, so the friend is only
    -- notified the first time.
    local rows = database_query([[
        WITH tree AS (
            SELECT tree.id,
                CASE WHEN tree.user_low = $1 THEN tree.user_high ELSE tree.user_low END AS partner_id
            FROM public.shared_trees tree
            WHERE tree.id = $2 AND tree.status = 'growing'
              AND (tree.user_low = $1 OR tree.user_high = $1)
              AND $3::date BETWEEN (now() AT TIME ZONE 'UTC')::date - 1
                               AND (now() AT TIME ZONE 'UTC')::date + 1
        ),
        allowed AS (
            SELECT tree.* FROM tree
            JOIN public.user_friends friend
              ON friend.user_id = $1 AND friend.friend_id = tree.partner_id
        ),
        watered AS (
            INSERT INTO public.shared_tree_waterings (tree_id, user_id, day, note)
            SELECT id, $1, $3::date, $4 FROM allowed
            ON CONFLICT (tree_id, user_id, day) DO UPDATE SET note = EXCLUDED.note
            RETURNING tree_id, (xmax = 0) AS is_new
        ),
        result AS (
            SELECT allowed.partner_id, watered.is_new,
                EXISTS (SELECT 1 FROM public.shared_tree_waterings theirs
                    WHERE theirs.tree_id = allowed.id AND theirs.user_id = allowed.partner_id
                      AND theirs.day = $3::date) AS grew
            FROM watered JOIN allowed ON allowed.id = watered.tree_id
        ),
        notified AS (
            INSERT INTO public.user_notifications (user_id, actor_id, notification_type)
            SELECT partner_id, $1, CASE WHEN grew THEN 'tree_grew' ELSE 'tree_watered' END
            FROM result WHERE is_new
            RETURNING id
        )
        SELECT (SELECT count(*) FROM tree) AS found,
            (SELECT count(*) FROM allowed) AS allowed,
            (SELECT grew FROM result) AS grew
    ]], user.id, tree_id, body.day, note)
    if not rows or not rows[1] then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not water the tree." })
    end
    if tonumber(rows[1].found) == 0 then
        return respond(ngx.HTTP_CONFLICT, { error = "This tree isn't growing right now. Check your device's date." })
    end
    if tonumber(rows[1].allowed) == 0 then
        return respond(ngx.HTTP_CONFLICT, { error = "Follow each other again to keep growing this tree." })
    end
    local grew = rows[1].grew == true or rows[1].grew == "t"
    return respond(ngx.HTTP_OK, { ok = true, grew = grew })
end

-- A side quest: saves today's streak when you checked in and your friend
-- didn't. Not allowed when yesterday was already saved by a side quest:
-- then it's your friend's turn.
local function handle_side_quest(user, tree_id, body)
    if not valid_checkin_day(body.day) then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "A valid day is required." })
    end
    local rows = database_query([[
        WITH tree AS (
            SELECT tree.id,
                CASE WHEN tree.user_low = $1 THEN tree.user_high ELSE tree.user_low END AS partner_id
            FROM public.shared_trees tree
            WHERE tree.id = $2 AND tree.status = 'growing'
              AND (tree.user_low = $1 OR tree.user_high = $1)
              AND $3::date BETWEEN (now() AT TIME ZONE 'UTC')::date - 1
                               AND (now() AT TIME ZONE 'UTC')::date + 1
        ),
        allowed AS (
            SELECT tree.* FROM tree
            JOIN public.user_friends friend
              ON friend.user_id = $1 AND friend.friend_id = tree.partner_id
            WHERE EXISTS (
                SELECT 1 FROM public.shared_tree_waterings mine
                WHERE mine.tree_id = tree.id AND mine.user_id = $1 AND mine.day = $3::date
            )
              AND NOT EXISTS (
                SELECT 1 FROM public.shared_tree_waterings theirs
                WHERE theirs.tree_id = tree.id AND theirs.user_id = tree.partner_id
                  AND theirs.day = $3::date
            )
              AND NOT EXISTS (
                SELECT 1 FROM public.shared_tree_side_quests yesterday
                WHERE yesterday.tree_id = tree.id AND yesterday.day = $3::date - 1
            )
        ),
        saved AS (
            INSERT INTO public.shared_tree_side_quests (tree_id, user_id, day, quest)
            SELECT id, $1, $3::date, $4 FROM allowed
            ON CONFLICT (tree_id, day) DO NOTHING
            RETURNING tree_id
        )
        SELECT (SELECT count(*) FROM allowed) AS allowed
    ]], user.id, tree_id, body.day, side_quest_for(tree_id, body.day))
    if not rows or not rows[1] then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not save the side quest." })
    end
    if tonumber(rows[1].allowed) == 0 then
        return respond(ngx.HTTP_CONFLICT, { error = "A side quest can't save today. Check in first, and it only works one day in a row." })
    end
    return respond(ngx.HTTP_OK, { ok = true })
end

-- A nudge: reminds your friend to check in today. Only on a growing
-- tree, only while you follow each other, only when they haven't checked
-- in yet that day, and only once a day.
local function handle_nudge(user, tree_id, body)
    if not valid_checkin_day(body.day) then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "A valid day is required." })
    end
    local rows = database_query([[
        WITH tree AS (
            SELECT tree.id,
                CASE WHEN tree.user_low = $1 THEN tree.user_high ELSE tree.user_low END AS partner_id
            FROM public.shared_trees tree
            WHERE tree.id = $2 AND tree.status = 'growing'
              AND (tree.user_low = $1 OR tree.user_high = $1)
              AND $3::date BETWEEN (now() AT TIME ZONE 'UTC')::date - 1
                               AND (now() AT TIME ZONE 'UTC')::date + 1
        ),
        allowed AS (
            SELECT tree.* FROM tree
            JOIN public.user_friends friend
              ON friend.user_id = $1 AND friend.friend_id = tree.partner_id
            WHERE NOT EXISTS (
                SELECT 1 FROM public.shared_tree_waterings watering
                WHERE watering.tree_id = tree.id AND watering.user_id = tree.partner_id
                  AND watering.day = $3::date
            )
        ),
        nudged AS (
            INSERT INTO public.shared_tree_nudges (tree_id, from_user, to_user, day)
            SELECT id, $1, partner_id, $3::date FROM allowed
            ON CONFLICT (tree_id, from_user, day) DO NOTHING
            RETURNING to_user
        ),
        notified AS (
            INSERT INTO public.user_notifications (user_id, actor_id, notification_type)
            SELECT to_user, $1, 'tree_nudge' FROM nudged
            RETURNING id
        )
        SELECT (SELECT count(*) FROM allowed) AS allowed,
            (SELECT count(*) FROM nudged) AS nudged
    ]], user.id, tree_id, body.day)
    if not rows or not rows[1] then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not send the nudge." })
    end
    if tonumber(rows[1].allowed) == 0 then
        return respond(ngx.HTTP_CONFLICT, { error = "No nudge needed: they already checked in, or you don't follow each other." })
    end
    return respond(ngx.HTTP_OK, { ok = true, already = tonumber(rows[1].nudged) == 0 })
end

-- Handles a POST tree action. Returns false when the action is not a tree
-- action, so community.lua can carry on with its own actions.
function M.handle_action(user, body)
    local action = body.action
    if action == "tree_plant" then
        return handle_plant(user, body)
    end
    if action ~= "tree_accept" and action ~= "tree_remove" and action ~= "tree_water"
        and action ~= "tree_nudge" and action ~= "tree_side_quest" then
        return false
    end
    local tree_id = valid_tree_id(body.treeId)
    if not tree_id then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "A valid tree is required." })
    end
    if action == "tree_accept" then
        return handle_accept(user, tree_id)
    elseif action == "tree_remove" then
        return handle_remove(user, tree_id)
    elseif action == "tree_nudge" then
        return handle_nudge(user, tree_id, body)
    elseif action == "tree_side_quest" then
        return handle_side_quest(user, tree_id, body)
    end
    return handle_water(user, tree_id, body)
end

return M
