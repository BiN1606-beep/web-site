-- The /api/routines endpoint: routines you want to repeat, and the days
-- you did them.
--
-- The Today tab (public/js/routines.js) lists the routines that are due
-- today, so you can tick them off, and lets you add, change and remove
-- routines. "Your stats" (public/js/my-stats.js) draws a month grid from
-- the same data: a box per day, filled when that day's routines were done.
--
--   GET                                       -> { routines, checks, today }
--   POST { action = "add",    title, repeat, day }
--   POST { action = "edit",   id, title, repeat }
--   POST { action = "remove", id, day }
--   POST { action = "check",  id, day, done }  (done = false un-ticks)
--   POST { action = "debug_reset" }            (debug accounts only)
--
-- "repeat" is { kind = "daily" } or { kind = "weekdays", days = {0..6} }
-- (0 = Monday) or { kind = "every", every = N }. See
-- db/migrations/015_routines.sql for how they are stored.
--
-- Every POST answers with the same body as GET, so the page simply redraws
-- from it. Every query has "user_id = <you>" in it: you can only ever see
-- or change your own routines, even with a hand-made request.

local cjson = require "cjson.safe"
local common = require "osiris.common"
local goals = require "osiris.goals"

local respond = common.respond
local database_query = common.database_query
local current_user = common.current_user
local read_json_body = common.read_json_body
local utf8_character_count = common.utf8_character_count
local valid_day = goals.valid_checkin_day
local is_debug_user = goals.is_progress_debug_user

local M = {}

local MAX_ROUTINES = 20
local MAX_TITLE = 80
local MAX_EVERY = 30
-- How far back GET sends your history: a year, plus a little so last
-- year's month is complete in the grid.
local HISTORY_DAYS = 400

-- Days since 1970-01-01 for a "YYYY-MM-DD" date, without time zones (the
-- usual "days from civil" formula). Used to compare dates and to count
-- "every N days".
local function day_number(day)
    local y, m, d = day:match("^(%d+)%-(%d+)%-(%d+)$")
    y, m, d = tonumber(y), tonumber(m), tonumber(d)
    if m <= 2 then
        y = y - 1
    end
    local era = math.floor(y / 400)
    local year_of_era = y - era * 400
    local day_of_year = math.floor((153 * (m + (m > 2 and -3 or 9)) + 2) / 5) + d - 1
    local day_of_era = year_of_era * 365 + math.floor(year_of_era / 4)
        - math.floor(year_of_era / 100) + day_of_year
    return era * 146097 + day_of_era - 719468
end

-- The browser sends the user's own local date. Like check-ins, only dates
-- within one day of the server's (UTC) date are accepted: time zones span
-- about +-14 hours, and nobody should tick off last week or next month.
local function near_today(day)
    if not valid_day(day) then
        return false
    end
    local today = math.floor(ngx.time() / 86400)
    return math.abs(day_number(day) - today) <= 1
end

-- 0 = Monday ... 6 = Sunday. 1970-01-01 was a Thursday (3).
local function weekday(day)
    return (day_number(day) + 3) % 7
end

-- Is the routine (a database row) due on this day?
local function is_due(routine, day)
    if day < routine.start_day then
        return false
    end
    if routine.removed_on and routine.removed_on ~= ngx.null and day >= routine.removed_on then
        return false
    end
    if routine.repeat_kind == "weekdays" then
        local bit = 2 ^ weekday(day)
        return math.floor(tonumber(routine.weekdays) / bit) % 2 == 1
    elseif routine.repeat_kind == "every" then
        return (day_number(day) - day_number(routine.start_day)) % tonumber(routine.every_days) == 0
    end
    return true
end

-- A clean title: trimmed, no control characters, 1-80 characters. Returns
-- nil when it isn't usable.
local function clean_title(value)
    if type(value) ~= "string" then
        return nil
    end
    local title = value:gsub("[%z\1-\31\127]", " "):gsub("%s+", " "):match("^%s*(.-)%s*$")
    local length = utf8_character_count(title)
    if not length or length < 1 or length > MAX_TITLE then
        return nil
    end
    return title
end

-- Turns the browser's "repeat" into the three columns, or nil.
local function clean_repeat(value)
    if type(value) ~= "table" then
        return nil
    end
    if value.kind == "daily" then
        return "daily", 127, 1
    elseif value.kind == "weekdays" then
        if type(value.days) ~= "table" or #value.days < 1 or #value.days > 7 then
            return nil
        end
        local mask = 0
        local seen = {}
        for _, day in ipairs(value.days) do
            if type(day) ~= "number" or day % 1 ~= 0 or day < 0 or day > 6 then
                return nil
            end
            if not seen[day] then
                seen[day] = true
                mask = mask + 2 ^ day
            end
        end
        return "weekdays", mask, 1
    elseif value.kind == "every" then
        local every = value.every
        if type(every) ~= "number" or every % 1 ~= 0 or every < 1 or every > MAX_EVERY then
            return nil
        end
        return "every", 127, every
    end
    return nil
end

-- The repeat rule as the browser sends it.
local function repeat_view(row)
    if row.repeat_kind == "weekdays" then
        local days = {}
        for day = 0, 6 do
            if math.floor(tonumber(row.weekdays) / 2 ^ day) % 2 == 1 then
                days[#days + 1] = day
            end
        end
        return { kind = "weekdays", days = days }
    elseif row.repeat_kind == "every" then
        return { kind = "every", every = tonumber(row.every_days) }
    end
    return { kind = "daily" }
end

local function load_routines(user_id)
    return database_query([[
        SELECT id, title, repeat_kind, weekdays, every_days,
               start_day::text AS start_day, removed_on::text AS removed_on
        FROM public.routines
        WHERE user_id = $1
          AND (removed_on IS NULL
               OR removed_on > (now() AT TIME ZONE 'UTC')::date - $2::int)
        ORDER BY id
    ]], user_id, HISTORY_DAYS)
end

-- Everything the page needs. Returns nil on a database error.
local function routines_payload(user_id)
    local rows = load_routines(user_id)
    local checks = rows and database_query([[
        SELECT routine_id, day::text AS day
        FROM public.routine_checks
        WHERE user_id = $1
          AND day > (now() AT TIME ZONE 'UTC')::date - $2::int
        ORDER BY day, routine_id
    ]], user_id, HISTORY_DAYS)
    if not rows or not checks then
        return nil
    end

    local routines = {}
    for _, row in ipairs(rows) do
        routines[#routines + 1] = {
            id = tonumber(row.id),
            title = row.title,
            ["repeat"] = repeat_view(row),
            start_day = row.start_day,
            removed_on = row.removed_on,
        }
    end
    local check_list = {}
    for _, check in ipairs(checks) do
        check_list[#check_list + 1] = { routine_id = tonumber(check.routine_id), day = check.day }
    end
    -- cjson sends an empty table as {}; the page expects lists.
    setmetatable(routines, cjson.array_mt)
    setmetatable(check_list, cjson.array_mt)
    return { routines = routines, checks = check_list }
end

local function reply_with_state(user_id, extra)
    local payload = routines_payload(user_id)
    if not payload then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not load your routines." })
    end
    for key, value in pairs(extra or {}) do
        payload[key] = value
    end
    return respond(ngx.HTTP_OK, payload)
end

local function valid_id(id)
    return type(id) == "number" and id % 1 == 0 and id >= 1 and id < 2 ^ 53
end

-- One of your own routines that hasn't been removed, or nil. The second
-- value is true on a database error.
local function own_routine(user_id, id)
    if not valid_id(id) then
        return nil, false
    end
    local rows = database_query([[
        SELECT id, repeat_kind, weekdays, every_days,
               start_day::text AS start_day, removed_on::text AS removed_on
        FROM public.routines
        WHERE id = $1 AND user_id = $2 AND removed_on IS NULL
    ]], id, user_id)
    if not rows then
        return nil, true
    end
    return rows[1], false
end

-- Were all routines due on this day done? This is where a reward for a
-- full day (for example gems) can hook in later: the reply to a "check"
-- says day_complete = true when the tick finished the day.
local function day_complete(user_id, day)
    local rows = load_routines(user_id)
    local checks = database_query([[
        SELECT routine_id FROM public.routine_checks WHERE user_id = $1 AND day = $2::date
    ]], user_id, day)
    if not rows or not checks then
        return false
    end
    local done = {}
    for _, check in ipairs(checks) do
        done[tonumber(check.routine_id)] = true
    end
    local due = 0
    for _, row in ipairs(rows) do
        if is_due(row, day) then
            due = due + 1
            if not done[tonumber(row.id)] then
                return false
            end
        end
    end
    return due > 0
end

local function handle_routines()
    local user, database_error = current_user()
    if database_error then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Authentication is temporarily unavailable." })
    end
    if not user then
        return respond(ngx.HTTP_UNAUTHORIZED, { error = "Please sign in to continue." })
    end

    local method = ngx.req.get_method()
    if method == "GET" then
        return reply_with_state(user.id)
    end
    if method ~= "POST" then
        return respond(ngx.HTTP_NOT_ALLOWED, { error = "Only GET and POST are supported." })
    end

    local body = read_json_body(2000)
    if not body or type(body.action) ~= "string" then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "A routines action is required." })
    end
    local action = body.action

    if action == "add" or action == "edit" then
        local title = clean_title(body.title)
        if not title then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "Give the routine a name (up to 80 characters)." })
        end
        local kind, weekdays, every = clean_repeat(body["repeat"])
        if not kind then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "Choose how often the routine repeats." })
        end

        if action == "add" then
            if not near_today(body.day) then
                return respond(ngx.HTTP_BAD_REQUEST, { error = "Your device's date looks wrong." })
            end
            -- The count and the insert are one statement, so two quick
            -- clicks can't slip past the limit.
            local rows = database_query([[
                INSERT INTO public.routines (user_id, title, repeat_kind, weekdays, every_days, start_day)
                SELECT $1, $2, $3, $4, $5, $6::date
                WHERE (SELECT count(*) FROM public.routines
                       WHERE user_id = $1 AND removed_on IS NULL) < $7
                RETURNING id
            ]], user.id, title, kind, weekdays, every, body.day, MAX_ROUTINES)
            if not rows then
                return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not save your routine." })
            end
            if not rows[1] then
                return respond(ngx.HTTP_CONFLICT, { error = "You can have up to " .. MAX_ROUTINES .. " routines." })
            end
            return reply_with_state(user.id, { added = tonumber(rows[1].id) })
        end

        if not valid_id(body.id) then
            return respond(ngx.HTTP_NOT_FOUND, { error = "That routine was not found." })
        end
        local rows = database_query([[
            UPDATE public.routines
            SET title = $3, repeat_kind = $4, weekdays = $5, every_days = $6
            WHERE id = $1 AND user_id = $2 AND removed_on IS NULL
            RETURNING id
        ]], body.id, user.id, title, kind, weekdays, every)
        if not rows then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not save your routine." })
        end
        if not rows[1] then
            return respond(ngx.HTTP_NOT_FOUND, { error = "That routine was not found." })
        end
        return reply_with_state(user.id)
    end

    if action == "remove" or action == "check" then
        if not near_today(body.day) then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "Your device's date looks wrong." })
        end
        local routine, failed = own_routine(user.id, body.id)
        if failed then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not load your routines." })
        end
        if not routine then
            return respond(ngx.HTTP_NOT_FOUND, { error = "That routine was not found." })
        end

        if action == "remove" then
            -- A routine made and removed on the same day has no history
            -- worth keeping, so it is deleted for real.
            local rows = database_query([[
                WITH gone AS (
                    DELETE FROM public.routines
                    WHERE id = $1 AND user_id = $2 AND start_day >= $3::date
                    RETURNING id
                )
                UPDATE public.routines SET removed_on = $3::date
                WHERE id = $1 AND user_id = $2 AND NOT EXISTS (SELECT 1 FROM gone)
                RETURNING id
            ]], routine.id, user.id, body.day)
            if not rows then
                return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not remove your routine." })
            end
            return reply_with_state(user.id)
        end

        if not is_due(routine, body.day) then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "That routine isn't on for that day." })
        end
        local rows
        if body.done == false then
            rows = database_query([[
                DELETE FROM public.routine_checks
                WHERE routine_id = $1 AND user_id = $2 AND day = $3::date
                RETURNING day
            ]], routine.id, user.id, body.day)
        else
            rows = database_query([[
                INSERT INTO public.routine_checks (routine_id, user_id, day)
                VALUES ($1, $2, $3::date)
                ON CONFLICT (routine_id, day) DO NOTHING
                RETURNING day
            ]], routine.id, user.id, body.day)
        end
        if not rows then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not save that." })
        end
        -- Only a new tick can complete a day (a repeated click doesn't).
        local completed = body.done ~= false and rows[1] ~= nil and day_complete(user.id, body.day)
        return reply_with_state(user.id, { day_complete = completed })
    end

    if action == "debug_reset" then
        if not is_debug_user(user) then
            return respond(ngx.HTTP_FORBIDDEN, { error = "Debug tools are not enabled for this account." })
        end
        if not database_query("DELETE FROM public.routines WHERE user_id = $1", user.id) then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not reset your routines." })
        end
        return reply_with_state(user.id)
    end

    return respond(ngx.HTTP_BAD_REQUEST, { error = "Unknown routines action." })
end

M.handle_routines = handle_routines
-- For tests and for other modules that may want them later.
M.is_due = is_due
M.day_number = day_number

return M
