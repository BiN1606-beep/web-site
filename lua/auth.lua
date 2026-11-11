local cjson = require "cjson.safe"
local M = {}

local SESSION_COOKIE = "osiris_session"
local STATE_COOKIE = "osiris_google_state"
local SESSION_MAX_AGE = 2592000

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

function M.require_page_session()
    local user, database_error = current_user()
    if database_error then
        ngx.status = ngx.HTTP_SERVICE_UNAVAILABLE
        ngx.say("Authentication is temporarily unavailable.")
        return ngx.exit(ngx.HTTP_SERVICE_UNAVAILABLE)
    end
    if not user then
        ngx.redirect("/login", ngx.HTTP_MOVED_TEMPORARILY)
        return false
    end
    ngx.ctx.auth_user = user
    return true
end

function M.require_api_session()
    local user, database_error = current_user()
    if database_error then
        respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Authentication is temporarily unavailable." })
        return false
    end
    if not user then
        respond(ngx.HTTP_UNAUTHORIZED, { error = "Please sign in to continue." })
        return false
    end
    ngx.ctx.auth_user = user
    return true
end

local function read_json_body()
    local content_type = ngx.var.http_content_type
    local media_type = content_type and content_type:match("^%s*([^;]+)")
    media_type = media_type and media_type:match("^%s*(.-)%s*$")
    if not media_type or media_type:lower() ~= "application/json" then
        return nil
    end

    ngx.req.read_body()
    local raw_body = ngx.req.get_body_data()
    if not raw_body or #raw_body > 8192 then
        return nil
    end
    local body = cjson.decode(raw_body)
    if type(body) ~= "table" then
        return nil
    end
    return body
end

local function valid_email(email)
    return type(email) == "string"
        and #email <= 254
        and email:match("^[%w%._%+%-]+@[%w%-%.]+%.[%a]+$") ~= nil
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

local function valid_password(password)
    return type(password) == "string"
        and #password <= 72
        and not password:find("%z")
        and (utf8_character_count(password) or 0) >= 12
end

local function create_session(user_id)
    local rows = database_query([[
        WITH generated AS (
            SELECT encode(gen_random_bytes(32), 'hex') AS token
        ),
        stored AS (
            INSERT INTO public.auth_sessions (token_hash, user_id, expires_at)
            SELECT encode(digest(generated.token, 'sha256'), 'hex'), $1, now() + interval '30 days'
            FROM generated
            RETURNING token_hash
        )
        SELECT generated.token
        FROM generated
        JOIN stored ON stored.token_hash = encode(digest(generated.token, 'sha256'), 'hex')
    ]], user_id)
    if not rows or not rows[1] or type(rows[1].token) ~= "string" then
        return false
    end
    set_cookie(SESSION_COOKIE, rows[1].token, {
        http_only = true,
        max_age = SESSION_MAX_AGE,
    })
    return true
end

local function handle_signup()
    if ngx.req.get_method() ~= "POST" then
        return respond(ngx.HTTP_NOT_ALLOWED, { error = "Only POST is supported." })
    end

    local body = read_json_body()
    if not body or not valid_email(body.email) or not valid_password(body.password) then
        return respond(ngx.HTTP_BAD_REQUEST, {
            error = "Enter a valid email and a password with at least 12 characters and no more than 72 bytes.",
        })
    end

    local email = string.lower(body.email)
    local rows = database_query([[
        INSERT INTO public.auth_users (email, password_hash)
        VALUES ($1, crypt($2, gen_salt('bf', 12)))
        ON CONFLICT (email) DO NOTHING
        RETURNING id, email
    ]], email, body.password)
    if not rows then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not create your account." })
    end
    if not rows[1] then
        return respond(ngx.HTTP_CONFLICT, { error = "An account with that email already exists." })
    end
    if not create_session(rows[1].id) then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Your account was created, but sign-in failed. Please sign in." })
    end
    return respond(ngx.HTTP_CREATED, {
        user = { email = rows[1].email },
    })
end

local function handle_login()
    if ngx.req.get_method() ~= "POST" then
        return respond(ngx.HTTP_NOT_ALLOWED, { error = "Only POST is supported." })
    end

    local body = read_json_body()
    if not body or not valid_email(body.email) or type(body.password) ~= "string"
        or #body.password == 0 or #body.password > 72 or body.password:find("%z") then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "Enter a valid email and password." })
    end

    local rows = database_query([[
        SELECT id, email
        FROM public.auth_users
        WHERE email = $1 AND password_hash = crypt($2, password_hash)
    ]], string.lower(body.email), body.password)
    if not rows then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Sign-in is temporarily unavailable." })
    end
    if not rows[1] then
        return respond(ngx.HTTP_UNAUTHORIZED, { error = "Email or password is incorrect." })
    end
    if not create_session(rows[1].id) then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not start your session." })
    end
    return respond(ngx.HTTP_OK, {
        user = { email = rows[1].email },
    })
end

local function handle_logout()
    if ngx.req.get_method() ~= "POST" then
        return respond(ngx.HTTP_NOT_ALLOWED, { error = "Only POST is supported." })
    end

    local token = ngx.var.cookie_osiris_session
    if token and #token == 64 and token:match("^[%da-fA-F]+$") then
        local rows = database_query([[
            DELETE FROM public.auth_sessions
            WHERE token_hash = encode(digest($1, 'sha256'), 'hex')
        ]], token)
        if not rows then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not end your session." })
        end
    end
    clear_cookie(SESSION_COOKIE, "/")
    return respond(ngx.HTTP_OK, { ok = true })
end

local function google_configuration()
    local client_id = os.getenv("GOOGLE_CLIENT_ID")
    local client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    local redirect_uri = os.getenv("GOOGLE_REDIRECT_URI")
    if not client_id or client_id == "" or not client_secret or client_secret == ""
        or not redirect_uri or not redirect_uri:match("^https://") then
        return nil
    end
    return client_id, client_secret, redirect_uri
end

local function google_error_redirect()
    clear_cookie(STATE_COOKIE, "/api/auth/google/callback")
    return ngx.redirect("/login?error=google", ngx.HTTP_MOVED_TEMPORARILY)
end

local function handle_google_start()
    if ngx.req.get_method() ~= "GET" then
        return respond(ngx.HTTP_NOT_ALLOWED, { error = "Only GET is supported." })
    end
    local client_id = google_configuration()
    if not client_id then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Google sign-in is not configured." })
    end

    local rows = database_query("SELECT encode(gen_random_bytes(32), 'hex') AS token")
    if not rows or not rows[1] then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not start Google sign-in." })
    end
    local state = rows[1].token
    set_cookie(STATE_COOKIE, state, {
        path = "/api/auth/google/callback",
        max_age = 600,
        http_only = true,
    })

    local authorize_url = "https://accounts.google.com/o/oauth2/v2/auth?"
        .. ngx.encode_args({
            client_id = client_id,
            redirect_uri = os.getenv("GOOGLE_REDIRECT_URI"),
            response_type = "code",
            scope = "openid email",
            state = state,
        })
    return ngx.redirect(authorize_url, ngx.HTTP_MOVED_TEMPORARILY)
end

local function handle_google_callback()
    if ngx.req.get_method() ~= "GET" then
        return respond(ngx.HTTP_NOT_ALLOWED, { error = "Only GET is supported." })
    end
    local client_id, client_secret, redirect_uri = google_configuration()
    if not client_id then
        return google_error_redirect()
    end

    local args = ngx.req.get_uri_args(5)
    local state_cookie = ngx.var.cookie_osiris_google_state
    if type(args.state) ~= "string" or not state_cookie or args.state ~= state_cookie
        or type(args.code) ~= "string" or #args.code == 0 or #args.code > 4096 then
        return google_error_redirect()
    end

    local token_response = ngx.location.capture("/_internal/google-token", {
        method = ngx.HTTP_POST,
        body = ngx.encode_args({
            code = args.code,
            client_id = client_id,
            client_secret = client_secret,
            redirect_uri = redirect_uri,
            grant_type = "authorization_code",
        }),
        headers = {
            ["Content-Type"] = "application/x-www-form-urlencoded",
        },
    })
    if not token_response or token_response.status ~= ngx.HTTP_OK then
        ngx.log(ngx.ERR, "Google OAuth token exchange failed with status ", token_response and token_response.status or "no response")
        return google_error_redirect()
    end
    local token_body = cjson.decode(token_response.body or "")
    if type(token_body) ~= "table" or type(token_body.access_token) ~= "string" then
        ngx.log(ngx.ERR, "Google OAuth token response was invalid")
        return google_error_redirect()
    end

    local userinfo_response = ngx.location.capture("/_internal/google-userinfo", {
        method = ngx.HTTP_GET,
        headers = {
            Authorization = "Bearer " .. token_body.access_token,
        },
    })
    if not userinfo_response or userinfo_response.status ~= ngx.HTTP_OK then
        ngx.log(ngx.ERR, "Google userinfo request failed with status ", userinfo_response and userinfo_response.status or "no response")
        return google_error_redirect()
    end
    local userinfo = cjson.decode(userinfo_response.body or "")
    if type(userinfo) ~= "table" or type(userinfo.sub) ~= "string"
        or not valid_email(userinfo.email) or userinfo.email_verified ~= true then
        ngx.log(ngx.ERR, "Google userinfo did not contain a verified email")
        return google_error_redirect()
    end

    local rows = database_query([[
        INSERT INTO public.auth_users (email, google_sub)
        VALUES ($1, $2)
        ON CONFLICT (email) DO UPDATE
        SET google_sub = EXCLUDED.google_sub
        WHERE public.auth_users.google_sub IS NULL
           OR public.auth_users.google_sub = EXCLUDED.google_sub
        RETURNING id
    ]], string.lower(userinfo.email), userinfo.sub)
    if not rows or not rows[1] then
        ngx.log(ngx.ERR, "Could not link the verified Google account")
        return google_error_redirect()
    end
    if not create_session(rows[1].id) then
        ngx.log(ngx.ERR, "Could not create a session for the Google account")
        return google_error_redirect()
    end

    clear_cookie(STATE_COOKIE, "/api/auth/google/callback")
    return ngx.redirect("/", ngx.HTTP_MOVED_TEMPORARILY)
end

function M.handle_request()
    local path = ngx.var.uri
    if path == "/api/auth/signup" then
        return handle_signup()
    elseif path == "/api/auth/login" then
        return handle_login()
    elseif path == "/api/auth/logout" then
        return handle_logout()
    elseif path == "/api/auth/me" then
        if ngx.req.get_method() ~= "GET" then
            return respond(ngx.HTTP_NOT_ALLOWED, { error = "Only GET is supported." })
        end
        local user, database_error = current_user()
        if database_error then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Authentication is temporarily unavailable." })
        end
        if not user then
            return respond(ngx.HTTP_UNAUTHORIZED, { authenticated = false })
        end
        return respond(ngx.HTTP_OK, {
            authenticated = true,
            user = { email = user.email },
        })
    elseif path == "/api/auth/google" then
        return handle_google_start()
    elseif path == "/api/auth/google/callback" then
        return handle_google_callback()
    end
    return respond(ngx.HTTP_NOT_FOUND, { error = "Authentication endpoint not found." })
end

return M
