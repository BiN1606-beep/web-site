-- Saved looks: small sets of choices that are saved on your account.
--
-- Both "Customize your network" (lua/osiris/network_style.lua) and the
-- theme and fonts in Settings (lua/osiris/appearance.lua) work the same
-- way: the browser sends a small JSON object, only known keys and values
-- are kept, and the clean copy is stored in a jsonb column on
-- auth_users. This file holds that shared logic once, so each look only
-- has to list its allowed choices.
--
-- A look is described by:
--   column   the auth_users column it is saved in (only ever set here in
--            code, never taken from a request)
--   name     words for error messages, e.g. "network style"
--   choices  key -> { allowed_value = true, ... }
--   sliders  keys whose value is a number from 0 to 1 (optional)
--   switches keys whose value is true or false (optional)
--
-- Anything else in a request is dropped, so a broken or hand-made request
-- can never store junk.

local cjson = require "cjson.safe"
local common = require "osiris.common"

local respond = common.respond
local database_query = common.database_query
local current_user = common.current_user
local read_json_body = common.read_json_body
local decode_json_value = common.decode_json_value

local M = {}

function M.new(look)
    local sliders = look.sliders or {}
    local switches = look.switches or {}
    local saved = {}

    -- Returns a clean copy of a look, or nil if it isn't a table.
    function saved.clean(value)
        if type(value) ~= "table" then
            return nil
        end
        local clean = {}
        for key, allowed in pairs(look.choices) do
            if type(value[key]) == "string" and allowed[value[key]] then
                clean[key] = value[key]
            end
        end
        for _, key in ipairs(sliders) do
            local number = value[key]
            if type(number) == "number" and number == number and number >= 0 and number <= 1 then
                -- Two decimals is plenty for a slider.
                clean[key] = math.floor(number * 100 + 0.5) / 100
            end
        end
        for _, key in ipairs(switches) do
            if type(value[key]) == "boolean" then
                clean[key] = value[key]
            end
        end
        return clean
    end

    -- The saved look for a user, or nil (also when the database fails, so
    -- the page is simply shown in the default look).
    function saved.load(user_id)
        local rows = database_query(
            "SELECT " .. look.column .. " AS look FROM public.auth_users WHERE id = $1", user_id)
        local value = rows and rows[1] and decode_json_value(rows[1].look, nil)
        return value and saved.clean(value) or nil
    end

    -- GET returns { style = ... }; POST { style = {...} } saves it and
    -- POST { reset = true } goes back to the default look.
    function saved.handle()
        local user, database_error = current_user()
        if database_error then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Authentication is temporarily unavailable." })
        end
        if not user then
            return respond(ngx.HTTP_UNAUTHORIZED, { error = "Please sign in to continue." })
        end

        local method = ngx.req.get_method()
        if method == "GET" then
            return respond(ngx.HTTP_OK, { style = saved.load(user.id) or cjson.null })
        end
        if method ~= "POST" then
            return respond(ngx.HTTP_NOT_ALLOWED, { error = "Only GET and POST are supported." })
        end

        local body = read_json_body(2000)
        if not body then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "Send the " .. look.name .. " as JSON." })
        end
        if body.reset == true then
            local rows = database_query(
                "UPDATE public.auth_users SET " .. look.column .. " = NULL WHERE id = $1 RETURNING id", user.id)
            if not rows then
                return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not reset your " .. look.name .. "." })
            end
            return respond(ngx.HTTP_OK, { style = cjson.null })
        end
        local clean = saved.clean(body.style)
        if not clean then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "The " .. look.name .. " is missing." })
        end
        local rows = database_query(
            "UPDATE public.auth_users SET " .. look.column .. " = $2::jsonb WHERE id = $1 RETURNING id",
            user.id, cjson.encode(clean))
        if not rows then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not save your " .. look.name .. "." })
        end
        return respond(ngx.HTTP_OK, { style = clean })
    end

    return saved
end

return M
