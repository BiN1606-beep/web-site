-- The /api/progress-tree endpoint: loading the focus goal and every action on it.
--
-- Part of the server code that auth.lua used to hold in one file. Each
-- module returns a table M with its functions; the names a module
-- borrows from another module are listed at the top.

local cjson = require "cjson.safe"
local M = {}
local common = require "osiris.common"
local goals = require "osiris.goals"
local reminders = require "osiris.reminders"
local coach = require "osiris.coach"
local network_style = require "osiris.network_style"
local appearance = require "osiris.appearance"

local respond = common.respond
local database_query = common.database_query
local current_user = common.current_user
local read_json_body = common.read_json_body
local utf8_character_count = common.utf8_character_count
local decode_json_value = common.decode_json_value
local valid_checkin_day = goals.valid_checkin_day
local save_checkin = goals.save_checkin
local load_progress_tree = goals.load_progress_tree
local create_progress_tree_row = goals.create_progress_tree_row
local progress_tree_payload = goals.progress_tree_payload
local is_progress_debug_user = goals.is_progress_debug_user
local MAX_GOALS = goals.MAX_GOALS
local vapid_public_key = reminders.vapid_public_key

local function handle_progress_tree()
    local user, database_error = current_user()
    if database_error then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Authentication is temporarily unavailable." })
    end
    if not user then
        return respond(ngx.HTTP_UNAUTHORIZED, { error = "Please sign in to continue." })
    end

    local method = ngx.req.get_method()
    if method == "GET" then
        local args = ngx.req.get_uri_args()
        if args.action == "debug_status" then
            if not is_progress_debug_user(user) then
                return respond(ngx.HTTP_FORBIDDEN, { error = "Debug menu is not enabled for this account." })
            end
            return respond(ngx.HTTP_OK, { enabled = true })
        end
        local row, load_error = load_progress_tree(user.id)
        if load_error then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not load your progress tree." })
        end
        return respond(ngx.HTTP_OK, {
            tree = progress_tree_payload(row, user.id),
            reminders_key = vapid_public_key(),
            -- How you like your network to look (nil = the default look).
            network_style = network_style.load_style(user.id),
            -- Your color theme and fonts (nil = the default look).
            appearance = appearance.load_appearance(user.id),
            -- true only for the accounts in lua/debug_menu_email.txt: shows
            -- the "Dev tools" button in Settings (public/js/devtools.js).
            dev = is_progress_debug_user(user) or nil,
        })
    end
    if method ~= "POST" then
        return respond(ngx.HTTP_NOT_ALLOWED, { error = "Only GET and POST are supported." })
    end

    local body = read_json_body(12000)
    if not body or type(body.action) ~= "string" then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "A progress-tree action is required." })
    end
    if (body.action == "debug_reset" or body.action == "debug_skip")
        and not is_progress_debug_user(user) then
        return respond(ngx.HTTP_FORBIDDEN, { error = "Debug tools are not enabled for this account." })
    end

    local row, load_error = load_progress_tree(user.id)
    if load_error then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not load your progress tree." })
    end

    -- Make another goal the active one, or remove a goal from the network.
    if body.action == "focus_goal" or body.action == "delete_goal" then
        local goal_id = tonumber(body.goalId)
        if not goal_id or goal_id < 1 or goal_id % 1 ~= 0 then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "Choose one of your goals." })
        end
        local owned = database_query([[
            SELECT id FROM public.user_progress_trees
            WHERE id = $1 AND user_id = $2 AND tree_data IS NOT NULL
        ]], goal_id, user.id)
        if not owned then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not load your goals." })
        end
        if not owned[1] then
            return respond(ngx.HTTP_NOT_FOUND, { error = "That goal was not found." })
        end
        if body.action == "focus_goal" then
            -- Switching focus cancels an unfinished interview for a new goal.
            -- These run one after another because only one goal may be
            -- active at a time (a unique index enforces that).
            if not database_query([[
                    DELETE FROM public.user_progress_trees
                    WHERE user_id = $1 AND tree_data IS NULL
                ]], user.id)
                or not database_query([[
                    UPDATE public.user_progress_trees SET is_active = false
                    WHERE user_id = $1 AND is_active AND id <> $2
                ]], user.id, goal_id)
                or not database_query([[
                    UPDATE public.user_progress_trees SET is_active = true, updated_at = now()
                    WHERE id = $1 AND user_id = $2
                ]], goal_id, user.id) then
                return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not switch goals." })
            end
        else
            -- If the removed goal was the active one, the most recently used
            -- remaining goal becomes active.
            if not database_query([[
                    DELETE FROM public.user_progress_trees
                    WHERE id = $1 AND user_id = $2
                ]], goal_id, user.id)
                or not database_query([[
                    UPDATE public.user_progress_trees SET is_active = true
                    WHERE id = (
                        SELECT id FROM public.user_progress_trees
                        WHERE user_id = $1
                        ORDER BY updated_at DESC
                        LIMIT 1
                    )
                    AND NOT EXISTS (
                        SELECT 1 FROM public.user_progress_trees
                        WHERE user_id = $1 AND is_active
                    )
                ]], user.id) then
                return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not remove that goal." })
            end
        end
        row, load_error = load_progress_tree(user.id)
        if load_error then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not load your progress tree." })
        end
        return respond(ngx.HTTP_OK, {
            tree = progress_tree_payload(row, user.id),
            focused = body.action == "focus_goal",
            deleted = body.action == "delete_goal",
        })
    end

    if body.action == "begin" then
        if not create_progress_tree_row(user.id) then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not start your progress-tree conversation." })
        end
        row, load_error = load_progress_tree(user.id)
        if load_error or not row then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not load your progress-tree conversation." })
        end
        local history = decode_json_value(row.conversation, {})
        if type(history) ~= "table" then history = {} end
        if not decode_json_value(row.tree_data, nil)
            and (#history == 0 or type(history[#history].choices) ~= "table") then
            local previous_history = row.conversation
            if type(previous_history) == "table" then
                previous_history = cjson.encode(previous_history)
            end
            previous_history = previous_history or "[]"
            history = {{
                role = "assistant",
                content = "What would you most like to work toward? Choose the closest starting point.",
                choices = {
                    "Improve my health, fitness, or energy",
                    "Learn a new skill or subject",
                    "Build confidence or improve my wellbeing",
                    "Grow in my career, studies, or business",
                    "Create better habits or a more balanced routine",
                    "Explore another personal goal",
                },
            }}
            local saved = database_query([[
                UPDATE public.user_progress_trees
                SET conversation = $2::jsonb, updated_at = now()
                WHERE user_id = $1 AND is_active AND tree_data IS NULL AND conversation = $3::jsonb
                RETURNING user_id
            ]], user.id, cjson.encode(history), previous_history)
            if not saved then
                return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not start your progress-tree conversation." })
            end
            row, load_error = load_progress_tree(user.id)
            if load_error or not row then
                return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not load your progress-tree conversation." })
            end
        end
        return respond(ngx.HTTP_OK, { tree = progress_tree_payload(row, user.id) })
    end

    if body.action == "start_new" or body.action == "debug_reset" then
        local initial_conversation = {{
            role = "assistant",
            content = "What would you most like to work toward? Choose the closest starting point.",
            choices = {
                "Improve my health, fitness, or energy",
                "Learn a new skill or subject",
                "Build confidence or improve my wellbeing",
                "Grow in my career, studies, or business",
                "Create better habits or a more balanced routine",
                "Explore another personal goal",
            },
        }}
        if body.action == "debug_reset" then
            -- Debug: remove every goal and start again from the interview.
            if not database_query([[
                DELETE FROM public.user_progress_trees WHERE user_id = $1
            ]], user.id) then
                return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not reset your goals." })
            end
        else
            -- "Start new" adds a goal: earlier goals stay in the network but
            -- are no longer active. An unfinished interview is replaced.
            local counts = database_query([[
                SELECT count(*) AS goal_count FROM public.user_progress_trees
                WHERE user_id = $1 AND tree_data IS NOT NULL
            ]], user.id)
            if not counts then
                return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not load your goals." })
            end
            if (tonumber(counts[1].goal_count) or 0) >= MAX_GOALS then
                return respond(ngx.HTTP_CONFLICT, {
                    error = "You can have up to " .. MAX_GOALS .. " goals. Remove one before adding another.",
                })
            end
            if not database_query([[
                    DELETE FROM public.user_progress_trees
                    WHERE user_id = $1 AND tree_data IS NULL
                ]], user.id)
                or not database_query([[
                    UPDATE public.user_progress_trees SET is_active = false
                    WHERE user_id = $1 AND is_active
                ]], user.id) then
                return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not start a new goal." })
            end
        end
        local reset = database_query([[
            INSERT INTO public.user_progress_trees (user_id, tree_data, completed_count, conversation, ai_memory, is_active)
            VALUES ($1, NULL, 0, $2::jsonb, '', true)
            RETURNING id, tree_data, completed_count, conversation, ai_memory
        ]], user.id, cjson.encode(initial_conversation))
        if not reset or not reset[1] then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not start a new progress tree." })
        end
        return respond(ngx.HTTP_OK, { tree = progress_tree_payload(reset[1], user.id), restarted = true })
    end

    if body.action == "debug_skip" then
        local count = tonumber(body.count)
        if not count or count < 1 or count > 20 or count % 1 ~= 0 then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "Choose a whole number of steps between 1 and 20." })
        end
        -- "before" reads the count from before the UPDATE (every part of one
        -- statement sees the same snapshot), so only the skipped steps get a
        -- completion date.
        local skipped = database_query([[
            WITH before AS (
                SELECT id, completed_count FROM public.user_progress_trees
                WHERE user_id = $1 AND is_active
            ),
            changed AS (
                UPDATE public.user_progress_trees
                SET completed_count = LEAST(
                        completed_count + $2::integer,
                        jsonb_array_length(tree_data->'steps')
                    ),
                    updated_at = now()
                WHERE user_id = $1 AND is_active
                  AND tree_data IS NOT NULL
                  AND jsonb_typeof(tree_data->'steps') = 'array'
                RETURNING id, user_id, tree_data, completed_count, conversation, ai_memory
            ),
            recorded AS (
                INSERT INTO public.step_completions (goal_id, user_id, step_index)
                SELECT changed.id, changed.user_id, step_index
                FROM changed
                JOIN before ON before.id = changed.id
                CROSS JOIN generate_series(before.completed_count, changed.completed_count - 1) AS step_index
                ON CONFLICT (goal_id, step_index) DO NOTHING
            )
            SELECT id, tree_data, completed_count, conversation, ai_memory FROM changed
        ]], user.id, count)
        if not skipped then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not skip progress-tree steps." })
        end
        if not skipped[1] then
            return respond(ngx.HTTP_CONFLICT, { error = "Create a progress tree before skipping steps." })
        end
        return respond(ngx.HTTP_OK, { tree = progress_tree_payload(skipped[1], user.id), skipped = true })
    end

    if body.action == "complete" then
        local expected_step = tonumber(body.expectedStep)
        if not row or not decode_json_value(row.tree_data, nil) then
            return respond(ngx.HTTP_CONFLICT, { error = "Create a progress tree before completing a step." })
        end
        if not expected_step or expected_step < 0 or expected_step % 1 ~= 0 then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "The current step is invalid." })
        end
        local saved_tree = decode_json_value(row.tree_data, nil)
        local current_step = saved_tree.steps and saved_tree.steps[(tonumber(row.completed_count) or 0) + 1]
        local required_tasks = current_step and current_step.tasks
        if type(required_tasks) == "table" and #required_tasks > 0 then
            if type(body.checkedTasks) ~= "table" or #body.checkedTasks ~= #required_tasks then
                return respond(ngx.HTTP_BAD_REQUEST, { error = "Check every listed task before completing this step." })
            end
            for index = 1, #required_tasks do
                if body.checkedTasks[index] ~= index then
                    return respond(ngx.HTTP_BAD_REQUEST, { error = "Check every listed task before completing this step." })
                end
            end
        end
        local updated = database_query([[
            WITH changed AS (
                UPDATE public.user_progress_trees
                SET completed_count = completed_count + 1, updated_at = now()
                WHERE user_id = $1 AND is_active
                  AND completed_count = $2
                  AND completed_count < jsonb_array_length(tree_data->'steps')
                RETURNING id, user_id, tree_data, completed_count, conversation, ai_memory
            ),
            -- Remember when the step was done. completed_count is already
            -- the new count here, so the finished step's 0-based index is
            -- one less.
            recorded AS (
                INSERT INTO public.step_completions (goal_id, user_id, step_index)
                SELECT id, user_id, completed_count - 1 FROM changed
                ON CONFLICT (goal_id, step_index) DO NOTHING
            ),
            activity AS (
                INSERT INTO public.community_activities (actor_id, activity_type, details)
                SELECT user_id, 'milestone_completed',
                    jsonb_build_object(
                        'step_title', tree_data->'steps'->(completed_count - 1)->>'title',
                        'completed_count', completed_count,
                        'progress', floor(completed_count::numeric
                            / jsonb_array_length(tree_data->'steps') * 100)
                    )
                FROM changed
                RETURNING id, actor_id
            ),
            notified AS (
                INSERT INTO public.user_notifications (user_id, actor_id, notification_type, activity_id)
                SELECT audience.user_id, activity.actor_id, 'milestone_completed', activity.id
                FROM activity
                JOIN changed ON changed.user_id = activity.actor_id
                JOIN (
                    SELECT f.follower_id AS user_id FROM public.user_follows f
                    WHERE f.followed_id = $1 AND f.status = 'accepted'
                ) audience ON true
                JOIN public.user_social_settings settings ON settings.user_id = activity.actor_id
                WHERE settings.show_activity
                RETURNING id
            )
            SELECT id, tree_data, completed_count, conversation, ai_memory FROM changed
        ]], user.id, expected_step)
        if not updated then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not save your progress." })
        end
        if not updated[1] then
            row, load_error = load_progress_tree(user.id)
            if load_error then
                return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not refresh your progress tree." })
            end
            return respond(ngx.HTTP_CONFLICT, {
                error = "Your progress changed in another session. Your tree has been refreshed.",
                tree = progress_tree_payload(row, user.id),
            })
        end
        -- Finishing a step also counts as showing up today. The step is
        -- already saved, so a failed or missing check-in must not undo it;
        -- it only means the streak doesn't get this day.
        if valid_checkin_day(body.day) then
            local step_title = current_step and current_step.title or "a step"
            local note = "Finished step: " .. step_title
            if #note > 280 then
                note = note:sub(1, 277) .. "..."
            end
            if save_checkin(user.id, tonumber(updated[1].id), body.day, note, false) == nil then
                ngx.log(ngx.ERR, "Could not save the check-in for a completed step")
            end
        end
        return respond(ngx.HTTP_OK, { tree = progress_tree_payload(updated[1], user.id), completed = true })
    end

    -- Undo the last completed step of the focus goal (a click by mistake).
    -- Everything "Complete step" added is taken back in one statement, so a
    -- complete-then-undo can't be used to farm streak days or feed posts:
    --  * the step's completion date,
    --  * the automatic "Finished step: ..." check-in from that day, but only
    --    if the user hasn't replaced it with their own line,
    --  * the community post about it (its notifications go with it).
    if body.action == "undo_step" then
        local expected_count = tonumber(body.expectedStep)
        if not expected_count or expected_count < 1 or expected_count % 1 ~= 0 then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "There is no finished step to undo." })
        end
        local day = valid_checkin_day(body.day) and body.day or ""
        local undone = database_query([[
            WITH changed AS (
                UPDATE public.user_progress_trees
                SET completed_count = completed_count - 1, updated_at = now()
                WHERE user_id = $1 AND is_active
                  AND completed_count = $2
                  AND completed_count > 0
                RETURNING id, user_id, tree_data, completed_count, conversation, ai_memory
            ),
            -- After the UPDATE, completed_count is the 0-based index of the
            -- step being undone.
            removed_date AS (
                DELETE FROM public.step_completions completion
                USING changed
                WHERE completion.goal_id = changed.id
                  AND completion.step_index = changed.completed_count
            ),
            removed_checkin AS (
                DELETE FROM public.daily_checkins checkin
                USING changed
                WHERE checkin.user_id = changed.user_id
                  AND checkin.goal_id = changed.id
                  AND checkin.day = NULLIF($3, '')::date
                  AND checkin.note = 'Finished step: '
                      || (changed.tree_data->'steps'->changed.completed_count->>'title')
            ),
            removed_activity AS (
                DELETE FROM public.community_activities
                WHERE id = (
                    SELECT activity.id
                    FROM public.community_activities activity, changed
                    WHERE activity.actor_id = changed.user_id
                      AND activity.activity_type = 'milestone_completed'
                      AND activity.details->>'step_title'
                          = changed.tree_data->'steps'->changed.completed_count->>'title'
                      AND activity.details->>'completed_count' = (changed.completed_count + 1)::text
                    ORDER BY activity.created_at DESC
                    LIMIT 1
                )
            )
            SELECT id, tree_data, completed_count, conversation, ai_memory FROM changed
        ]], user.id, expected_count, day)
        if not undone then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not undo the step." })
        end
        if not undone[1] then
            row, load_error = load_progress_tree(user.id)
            if load_error then
                return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not refresh your progress tree." })
            end
            return respond(ngx.HTTP_CONFLICT, {
                error = "Your progress changed in another session. Your tree has been refreshed.",
                tree = progress_tree_payload(row, user.id),
            })
        end
        return respond(ngx.HTTP_OK, { tree = progress_tree_payload(undone[1], user.id), undone = true })
    end

    if body.action == "step_guide" then
        return coach.step_guide(user, row, body)
    end
    if body.action == "evolve" then
        return coach.evolve(user, row, body, MAX_GOALS)
    end
    if body.action == "weekly_review" then
        return coach.weekly_review(user, row, body)
    end

    if body.action == "reminder_subscribe" then
        return reminders.subscribe(user, body)
    end
    if body.action == "reminder_unsubscribe" then
        return reminders.unsubscribe(user, body)
    end

    -- A daily check-in: one short line about what you did today. Sending it
    -- again on the same day replaces the line.
    if body.action == "checkin" then
        if not row or not decode_json_value(row.tree_data, nil) then
            return respond(ngx.HTTP_CONFLICT, { error = "Create a goal before checking in." })
        end
        if not valid_checkin_day(body.day) then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "The check-in date is invalid." })
        end
        local note = type(body.note) == "string" and body.note:match("^%s*(.-)%s*$") or ""
        local note_length = utf8_character_count(note)
        if not note_length or note_length < 1 or note_length > 280 then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "Write one line (up to 280 characters) about what you did today." })
        end
        local saved = save_checkin(user.id, tonumber(row.id), body.day, note, true)
        if saved == nil then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not save your check-in." })
        end
        if not saved then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "You can only check in for today. Check your device's date." })
        end
        return respond(ngx.HTTP_OK, { tree = progress_tree_payload(row, user.id), checked_in = true })
    end

    -- Everything else is a conversation with the AI coach.
    return coach.converse(user, row, body)
end

M.handle_progress_tree = handle_progress_tree

return M
