-- Goals and their data: checking AI roadmaps, completion dates, check-ins, and what the browser gets to see of a goal.
--
-- Part of the server code that auth.lua used to hold in one file. Each
-- module returns a table M with its functions; the names a module
-- borrows from another module are listed at the top.

local cjson = require "cjson.safe"
local M = {}
local common = require "osiris.common"

local database_query = common.database_query
local decode_json_value = common.decode_json_value

-- Each goal belongs to one life area. Goals in the same area are grouped
-- around one hub in the progress network.
local LIFE_AREAS = { "Health", "Learning", "Mind", "Career", "Creativity", "Relationships", "Money", "Other" }

-- How many goals (finished or not) one person can keep in their network.
local MAX_GOALS = 8

-- A step's how-to list: 2-5 short instructions. Returns the valid ones, or
-- nil when fewer than 2 are usable.
local function valid_how_list(how)
    if type(how) ~= "table" then
        return nil
    end
    local items = {}
    for _, item in ipairs(how) do
        if type(item) == "string" and #item > 0 and #item <= 240 and #items < 5 then
            items[#items + 1] = item
        end
    end
    return #items >= 2 and items or nil
end

local function validate_tree(tree)
    if type(tree) ~= "table"
        or type(tree.goal) ~= "string" or #tree.goal == 0 or #tree.goal > 200
        or type(tree.summary) ~= "string" or #tree.summary > 500
        or type(tree.steps) ~= "table" or #tree.steps < 3 or #tree.steps > 30 then
        return false, "tree goal, summary, or step count is outside its limits"
    end
    -- The area only groups goals in the network, so an unknown value becomes
    -- "Other" instead of rejecting the whole tree.
    local known_area = false
    for _, area in ipairs(LIFE_AREAS) do
        if tree.area == area then
            known_area = true
        end
    end
    if not known_area then
        tree.area = "Other"
    end
    for index, step in ipairs(tree.steps) do
        if type(step) ~= "table"
            or type(step.title) ~= "string" or #step.title == 0 or #step.title > 100
            or type(step.description) ~= "string" or #step.description == 0 or #step.description > 500
            or type(step.why) ~= "string" or #step.why == 0 or #step.why > 400
            or (step.tip ~= nil and step.tip ~= cjson.null
                and (type(step.tip) ~= "string" or #step.tip > 300)) then
            return false, "step " .. index .. " has a missing or overlong required field"
        end
        if step.tip == cjson.null then
            step.tip = nil
        end
        if step.tasks == cjson.null then
            step.tasks = nil
        end
        -- Optional skill tags (for example "Consistency" or "HTML") connect
        -- steps in the network view. They are only decoration, so instead of
        -- rejecting the whole tree for a bad tag we keep the valid ones.
        if type(step.skills) == "table" then
            local skills = {}
            for _, skill in ipairs(step.skills) do
                if type(skill) == "string" and #skill > 0 and #skill <= 30 and #skills < 3 then
                    skills[#skills + 1] = skill
                end
            end
            step.skills = #skills > 0 and skills or nil
        else
            step.skills = nil
        end
        -- Optional time estimate ("20 min a day for a week") and how-to
        -- list. Like skills they only add detail, so bad values are dropped
        -- instead of rejecting the tree.
        if type(step.time) ~= "string" or #step.time == 0 or #step.time > 60 then
            step.time = nil
        end
        step.how = valid_how_list(step.how)
        if step.tasks ~= nil then
            if type(step.tasks) ~= "table" or #step.tasks > 4 then
                return false, "step " .. index .. " has an invalid task list"
            end
            for _, task in ipairs(step.tasks) do
                if type(task) ~= "string" or #task == 0 or #task > 160 then
                    return false, "step " .. index .. " has an invalid task"
                end
            end
        end
    end
    return true
end

-- When each of a user's steps was completed, as
-- dates[goal_id][step_index] = "2026-11-24T18:05:00Z" (UTC, ISO 8601, so the
-- browser can read it with new Date()). Steps finished before migration 008
-- have no entry: their date was never saved.
local function load_step_completions(user_id)
    local rows = database_query([[
        SELECT goal_id, step_index,
            to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS completed_at
        FROM public.step_completions
        WHERE user_id = $1
    ]], user_id)
    if not rows then
        return nil
    end
    local dates = {}
    for _, completion in ipairs(rows) do
        local goal_id = tonumber(completion.goal_id)
        dates[goal_id] = dates[goal_id] or {}
        dates[goal_id][tonumber(completion.step_index)] = completion.completed_at
    end
    return dates
end

-- The user's daily check-ins, newest first, as { day = "2026-11-24",
-- note = "..." }. The browser works out the streak from these days, because
-- only the browser knows what "today" is in the user's time zone. 400 days
-- is more than any streak shown needs and keeps the answer small.
local function load_checkins(user_id)
    return database_query([[
        SELECT day::text AS day, note
        FROM public.daily_checkins
        WHERE user_id = $1
        ORDER BY day DESC
        LIMIT 400
    ]], user_id)
end

-- A check-in day must be a real calendar date written as YYYY-MM-DD. (Its
-- distance from today is checked by the database when saving.)
local function valid_checkin_day(day)
    if type(day) ~= "string" then
        return false
    end
    local year, month, date = day:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)$")
    if not year then
        return false
    end
    -- os.time rolls impossible dates over (31 Feb becomes 3 Mar), so
    -- formatting it back reveals them.
    local time = os.time({ year = tonumber(year), month = tonumber(month), day = tonumber(date), hour = 12 })
    return time ~= nil and os.date("%Y-%m-%d", time) == day
end

-- Saves a check-in for the user's local "day". When overwrite is true an
-- existing check-in for that day gets the new note (editing today's line);
-- otherwise the first check-in of the day is kept. Returns true when saved,
-- false when the day is too far from today, and nil on a database error.
local function save_checkin(user_id, goal_id, day, note, overwrite)
    local rows = database_query([[
        INSERT INTO public.daily_checkins (user_id, goal_id, day, note)
        SELECT $1, $2, $3::date, $4
        WHERE $3::date BETWEEN (now() AT TIME ZONE 'UTC')::date - 1
                           AND (now() AT TIME ZONE 'UTC')::date + 1
        ON CONFLICT (user_id, day) DO UPDATE
            SET note = CASE WHEN $5::boolean THEN EXCLUDED.note ELSE daily_checkins.note END,
                goal_id = CASE WHEN $5::boolean THEN EXCLUDED.goal_id ELSE daily_checkins.goal_id END
        RETURNING day
    ]], user_id, goal_id, day, note, overwrite == true)
    if not rows then
        return nil
    end
    return rows[1] ~= nil
end

-- The finished steps of a goal, each with its completion date when known.
-- goal_dates is one goal's entry from load_step_completions, or nil.
local function completed_steps(steps, completed_count, goal_dates)
    local completed = {}
    for index = 1, math.min(completed_count, #steps) do
        completed[#completed + 1] = {
            title = steps[index].title,
            skills = steps[index].skills,
            -- step_index in the database is 0-based, Lua tables are 1-based.
            completed_at = goal_dates and goal_dates[index - 1] or nil,
        }
    end
    return completed
end

local function progress_tree_view(row, dates)
    local tree = decode_json_value(row.tree_data, nil)
    local conversation = decode_json_value(row.conversation, {})
    if type(conversation) ~= "table" then
        conversation = {}
    end
    local history = {}
    local first = math.max(1, #conversation - 29)
    for index = first, #conversation do
        local message = conversation[index]
        if type(message) == "table"
            and (message.role == "assistant" or message.role == "user")
            and type(message.content) == "string" then
            history[#history + 1] = {
                role = message.role,
                content = message.content,
                choices = type(message.choices) == "table" and message.choices or nil,
            }
        end
    end

    if not tree then
        return {
            exists = false,
            conversation = history,
        }
    end

    local completed_count = tonumber(row.completed_count) or 0
    local steps = tree.steps
    local completed = completed_steps(steps, completed_count, dates and dates[tonumber(row.id)])
    local current = steps[completed_count + 1]
    return {
        exists = true,
        id = tonumber(row.id),
        goal = tree.goal,
        area = tree.area or "Other",
        summary = tree.summary,
        completed_count = completed_count,
        total_steps = #steps,
        progress = math.floor(completed_count / #steps * 100),
        completed = completed,
        current_step = current,
        finished = current == nil,
        conversation = history,
    }
end

-- Loads the user's active goal: the one shown in the side panel, which the
-- interview, the AI coach and "Complete step" work on.
local function load_progress_tree(user_id)
    local rows = database_query([[
        SELECT id, tree_data, completed_count, conversation, ai_memory
        FROM public.user_progress_trees
        WHERE user_id = $1 AND is_active
    ]], user_id)
    if not rows then
        return nil, true
    end
    return rows[1], false
end

local function create_progress_tree_row(user_id)
    local rows = database_query([[
        INSERT INTO public.user_progress_trees (user_id)
        VALUES ($1)
        ON CONFLICT (user_id) WHERE is_active DO NOTHING
        RETURNING user_id
    ]], user_id)
    return rows ~= nil
end

-- A short summary of every goal that has a roadmap, for drawing the whole
-- network. Like the main view, it only reveals finished steps and the
-- current step; later steps stay hidden.
local function load_goal_summaries(user_id, dates)
    local rows = database_query([[
        SELECT id, is_active, tree_data, completed_count
        FROM public.user_progress_trees
        WHERE user_id = $1 AND tree_data IS NOT NULL
        ORDER BY created_at, id
    ]], user_id)
    if not rows then
        return nil
    end
    local goals = {}
    for _, row in ipairs(rows) do
        local tree = decode_json_value(row.tree_data, nil)
        if type(tree) == "table" and type(tree.steps) == "table" and #tree.steps > 0 then
            local completed_count = tonumber(row.completed_count) or 0
            local completed = completed_steps(tree.steps, completed_count, dates and dates[tonumber(row.id)])
            local current = tree.steps[completed_count + 1]
            goals[#goals + 1] = {
                id = tonumber(row.id),
                active = row.is_active == true or row.is_active == "t",
                goal = tree.goal,
                area = tree.area or "Other",
                completed_count = completed_count,
                total_steps = #tree.steps,
                completed = completed,
                current_step = current and { title = current.title, skills = current.skills } or nil,
                finished = current == nil,
            }
        end
    end
    return goals
end

-- The active goal's full view plus the summary of all goals.
local function progress_tree_payload(row, user_id)
    -- If the dates cannot be loaded the network still works, just without them.
    local dates = load_step_completions(user_id)
    local view = row and progress_tree_view(row, dates) or { exists = false, conversation = {} }
    view.goals = load_goal_summaries(user_id, dates) or {}
    -- Like the dates, a failed load only hides the streak. cjson would turn
    -- an empty Lua table into {}, so the browser also accepts an object.
    view.checkins = load_checkins(user_id) or {}
    view.max_goals = MAX_GOALS
    return view
end

local function is_progress_debug_user(user)
    local file = io.open("/opt/mysite/lua/debug_menu_email.txt", "r")
    if not file then
        return false
    end
    local debug_emails = file:read("*a")
    file:close()
    if type(debug_emails) ~= "string" or type(user.email) ~= "string" then
        return false
    end
    for debug_email in string.gmatch(debug_emails, "[^,]+") do
        debug_email = string.match(debug_email, "^%s*(.-)%s*$")
        if debug_email ~= "" and string.lower(user.email) == string.lower(debug_email) then
            return true
        end
    end
    return false
end

M.valid_how_list = valid_how_list
M.validate_tree = validate_tree
M.load_step_completions = load_step_completions
M.load_checkins = load_checkins
M.valid_checkin_day = valid_checkin_day
M.save_checkin = save_checkin
M.completed_steps = completed_steps
M.progress_tree_view = progress_tree_view
M.load_progress_tree = load_progress_tree
M.create_progress_tree_row = create_progress_tree_row
M.load_goal_summaries = load_goal_summaries
M.progress_tree_payload = progress_tree_payload
M.is_progress_debug_user = is_progress_debug_user
M.LIFE_AREAS = LIFE_AREAS
M.MAX_GOALS = MAX_GOALS

return M
