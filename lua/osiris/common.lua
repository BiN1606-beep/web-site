-- Shared helpers for every API: JSON replies, cookies, the database, the signed-in user, request bodies and text checks.
--
-- Part of the server code that auth.lua used to hold in one file. Each
-- module returns a table M with its functions; the names a module
-- borrows from another module are listed at the top.

local cjson = require "cjson.safe"
local M = {}

local SESSION_COOKIE = "osiris_session"
local STATE_COOKIE = "osiris_google_state"
local SESSION_MAX_AGE = 2592000
local REMEMBERED_SESSION_MAX_AGE = 15552000

local function respond(status, body)
    ngx.status = status
    ngx.header.content_type = "application/json; charset=utf-8"
    ngx.header["Cache-Control"] = "no-store"
    ngx.header["X-Content-Type-Options"] = "nosniff"
    if status == 405 then
        ngx.header.allow = "GET, POST"
    end
    ngx.say(cjson.encode(body))
    return ngx.exit(status)
end

local function secure_cookie_attribute()
    if ngx.var.scheme == "https" or ngx.var.http_x_forwarded_proto == "https" then
        return "; Secure"
    end
    return ""
end

local function set_cookie(name, value, options)
    local path = options.path or "/"
    local max_age = options.max_age
    local cookie = name .. "=" .. value .. "; Path=" .. path .. "; SameSite=Lax"
    if options.http_only then
        cookie = cookie .. "; HttpOnly"
    end
    if max_age then
        cookie = cookie .. "; Max-Age=" .. max_age
    end
    cookie = cookie .. secure_cookie_attribute()

    local existing = ngx.header["Set-Cookie"]
    if existing then
        if type(existing) ~= "table" then
            existing = { existing }
        end
        existing[#existing + 1] = cookie
        ngx.header["Set-Cookie"] = existing
    else
        ngx.header["Set-Cookie"] = cookie
    end
end

local function clear_cookie(name, path)
    set_cookie(name, "", { path = path, max_age = 0, http_only = true })
end

local function database_query(sql, ...)
    local arguments = { ... }
    local host = os.getenv("PGHOST")
    local database = os.getenv("PGDATABASE")
    local user = os.getenv("PGUSER")
    local password = os.getenv("PGPASSWORD")
    local port = os.getenv("PGPORT") or "5432"
    if not host or not database or not user or not password then
        ngx.log(ngx.ERR, "Authentication database connection environment is incomplete")
        return nil
    end

    local pgmoon = require "pgmoon"
    local pg = pgmoon.new({
        host = host,
        port = port,
        database = database,
        user = user,
        password = password,
    })

    local connect_ok, connected, connect_error = pcall(function()
        return pg:connect()
    end)
    if not connect_ok or not connected then
        ngx.log(ngx.ERR, "Authentication database connection failed: ", connect_error or connected or "unknown error")
        return nil
    end

    local query_ok, result, query_error = pcall(function()
        return pg:query(sql, unpack(arguments))
    end)
    pg:disconnect()

    if not query_ok or not result then
        ngx.log(ngx.ERR, "Authentication database query failed: ", query_error or result or "unknown error")
        return nil
    end
    return result
end

local function current_user()
    local token = ngx.var.cookie_osiris_session
    if not token or #token ~= 64 or not token:match("^[%da-fA-F]+$") then
        return nil, false
    end

    local rows = database_query([[
        SELECT users.id, users.email
        FROM public.auth_sessions AS sessions
        JOIN public.auth_users AS users ON users.id = sessions.user_id
        WHERE sessions.token_hash = encode(digest($1, 'sha256'), 'hex')
          AND sessions.expires_at > now()
    ]], token)
    if not rows then
        return nil, true
    end
    return rows[1], false
end

local function read_json_body(max_bytes)
    local content_type = ngx.var.http_content_type
    local media_type = content_type and content_type:match("^%s*([^;]+)")
    media_type = media_type and media_type:match("^%s*(.-)%s*$")
    if not media_type or media_type:lower() ~= "application/json" then
        return nil
    end

    ngx.req.read_body()
    local raw_body = ngx.req.get_body_data()
    if not raw_body or #raw_body > (max_bytes or 8192) then
        return nil
    end
    local body = cjson.decode(raw_body)
    if type(body) ~= "table" then
        return nil
    end
    return body
end

local function utf8_character_count(value)
    local count = 0
    local index = 1
    while index <= #value do
        local first = value:byte(index)
        local size
        if first < 0x80 then
            size = 1
        elseif first >= 0xC2 and first <= 0xDF then
            size = 2
        elseif first >= 0xE0 and first <= 0xEF then
            size = 3
        elseif first >= 0xF0 and first <= 0xF4 then
            size = 4
        else
            return nil
        end

        if index + size - 1 > #value then
            return nil
        end
        local second = size > 1 and value:byte(index + 1) or nil
        if (first == 0xE0 and second < 0xA0)
            or (first == 0xED and second > 0x9F)
            or (first == 0xF0 and second < 0x90)
            or (first == 0xF4 and second > 0x8F) then
            return nil
        end
        for offset = 2, size do
            local byte = value:byte(index + offset - 1)
            if byte < 0x80 or byte > 0xBF then
                return nil
            end
        end

        count = count + 1
        index = index + size
    end
    return count
end

local function decode_json_value(value, fallback)
    if type(value) == "table" then
        return value
    end
    if type(value) == "string" then
        return cjson.decode(value) or fallback
    end
    return fallback
end

M.respond = respond
M.secure_cookie_attribute = secure_cookie_attribute
M.set_cookie = set_cookie
M.clear_cookie = clear_cookie
M.database_query = database_query
M.current_user = current_user
M.read_json_body = read_json_body
M.utf8_character_count = utf8_character_count
M.decode_json_value = decode_json_value
M.SESSION_COOKIE = SESSION_COOKIE
M.STATE_COOKIE = STATE_COOKIE
M.SESSION_MAX_AGE = SESSION_MAX_AGE
M.REMEMBERED_SESSION_MAX_AGE = REMEMBERED_SESSION_MAX_AGE

return M
