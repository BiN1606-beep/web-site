-- The /api/network-style endpoint: how your progress network looks.
--
-- The "Customize" button on the network (public/js/network-style.js) lets
-- you pick a shape, colors, a background and how hard the lines pull. The
-- choice is saved on your account (auth_users.network_style) so it is the
-- same on every device. GET /api/progress-tree also sends it, so the
-- network is drawn in your style straight away.
--
-- Only known keys and values are kept; anything else is dropped, so a
-- broken or hand-made request can never store junk.

local cjson = require "cjson.safe"
local M = {}
local common = require "osiris.common"

local respond = common.respond
local database_query = common.database_query
local current_user = common.current_user
local read_json_body = common.read_json_body
local decode_json_value = common.decode_json_value

-- The allowed choices. Keep these in step with STYLE_CHOICES in
-- public/js/network-style.js.
local CHOICES = {
    shape = { web = true, tree = true, galaxy = true, orbit = true, lines = true },
    palette = { areas = true, forest = true, sunset = true, ocean = true, ink = true },
    sky = { plain = true, dots = true, stars = true },
}
-- Sliders are numbers from 0 to 1.
local SLIDERS = { "pull", "spread", "dots" }
-- On/off switches.
local SWITCHES = { "curved", "names" }

-- Returns a clean copy of a style, or nil if it isn't a table.
local function clean_style(style)
    if type(style) ~= "table" then
        return nil
    end
    local clean = {}
    for key, allowed in pairs(CHOICES) do
        if type(style[key]) == "string" and allowed[style[key]] then
            clean[key] = style[key]
        end
    end
    for _, key in ipairs(SLIDERS) do
        local value = style[key]
        if type(value) == "number" and value == value and value >= 0 and value <= 1 then
            -- Two decimals is plenty for a slider.
            clean[key] = math.floor(value * 100 + 0.5) / 100
        end
    end
    for _, key in ipairs(SWITCHES) do
        if type(style[key]) == "boolean" then
            clean[key] = style[key]
        end
    end
    return clean
end

-- The saved style for a user, or nil (also when the database fails, so the
-- network is simply drawn in the default style).
local function load_style(user_id)
    local rows = database_query([[
        SELECT network_style FROM public.auth_users WHERE id = $1
    ]], user_id)
    local saved = rows and rows[1] and decode_json_value(rows[1].network_style, nil)
    return saved and clean_style(saved) or nil
end

local function handle_network_style()
    local user, database_error = current_user()
    if database_error then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Authentication is temporarily unavailable." })
    end
    if not user then
        return respond(ngx.HTTP_UNAUTHORIZED, { error = "Please sign in to continue." })
    end

    local method = ngx.req.get_method()
    if method == "GET" then
        return respond(ngx.HTTP_OK, { style = load_style(user.id) or cjson.null })
    end
    if method ~= "POST" then
        return respond(ngx.HTTP_NOT_ALLOWED, { error = "Only GET and POST are supported." })
    end

    local body = read_json_body(2000)
    if not body then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "Send the style as JSON." })
    end
    -- { "reset": true } goes back to the default look.
    if body.reset == true then
        local rows = database_query([[
            UPDATE public.auth_users SET network_style = NULL WHERE id = $1 RETURNING id
        ]], user.id)
        if not rows then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not reset your network style." })
        end
        return respond(ngx.HTTP_OK, { style = cjson.null })
    end
    local style = clean_style(body.style)
    if not style then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "The network style is missing." })
    end
    local rows = database_query([[
        UPDATE public.auth_users SET network_style = $2::jsonb WHERE id = $1 RETURNING id
    ]], user.id, cjson.encode(style))
    if not rows then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not save your network style." })
    end
    return respond(ngx.HTTP_OK, { style = style })
end

M.clean_style = clean_style
M.load_style = load_style
M.handle_network_style = handle_network_style

return M
