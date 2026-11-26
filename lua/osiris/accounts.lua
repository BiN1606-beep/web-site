-- Accounts: email sign-up and sign-in, sessions, sign-out, the profile, and Google sign-in.
--
-- Part of the server code that auth.lua used to hold in one file. Each
-- module returns a table M with its functions; the names a module
-- borrows from another module are listed at the top.

local cjson = require "cjson.safe"
local M = {}
local common = require "osiris.common"

local respond = common.respond
local set_cookie = common.set_cookie
local clear_cookie = common.clear_cookie
local database_query = common.database_query
local current_user = common.current_user
local read_json_body = common.read_json_body
local utf8_character_count = common.utf8_character_count
local SESSION_COOKIE = common.SESSION_COOKIE
local STATE_COOKIE = common.STATE_COOKIE
local SESSION_MAX_AGE = common.SESSION_MAX_AGE
local REMEMBERED_SESSION_MAX_AGE = common.REMEMBERED_SESSION_MAX_AGE

local function valid_email(email)
    return type(email) == "string"
        and #email <= 254
        and email:match("^[%w%._%+%-]+@[%w%-%.]+%.[%a]+$") ~= nil
end

local function valid_password(password)
    return type(password) == "string"
        and #password <= 72
        and not password:find("%z")
        and (utf8_character_count(password) or 0) >= 12
end

local function create_session(user_id, remember_me)
    local session_duration = remember_me == true and "180 days" or "30 days"
    local rows = database_query([[
        WITH generated AS (
            SELECT encode(gen_random_bytes(32), 'hex') AS token
        ),
        stored AS (
            INSERT INTO public.auth_sessions (token_hash, user_id, expires_at)
            SELECT encode(digest(generated.token, 'sha256'), 'hex'), $1, now() + $2::interval
            FROM generated
            RETURNING token_hash
        )
        SELECT generated.token
        FROM generated
        JOIN stored ON stored.token_hash = encode(digest(generated.token, 'sha256'), 'hex')
    ]], user_id, session_duration)
    if not rows or not rows[1] or type(rows[1].token) ~= "string" then
        return false
    end
    local cookie_options = { http_only = true }
    if remember_me == true then
        cookie_options.max_age = REMEMBERED_SESSION_MAX_AGE
    elseif remember_me == nil then
        cookie_options.max_age = SESSION_MAX_AGE
    end
    set_cookie(SESSION_COOKIE, rows[1].token, cookie_options)
    -- Tidy up: sessions that ran out are useless, so remove them instead of
    -- keeping them forever. A failure here doesn't matter for this sign-in.
    database_query("DELETE FROM public.auth_sessions WHERE expires_at <= now()")
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

-- Login protection (see db/migrations/015_login_security.sql): after
-- MAX_LOGIN_FAILURES wrong passwords for one email within
-- LOGIN_FAILURE_WINDOW, that email is paused for LOGIN_LOCK_TIME. nginx
-- also limits how often one computer can try (auth_requests_v2 in
-- nginx.conf); this catches guesses spread over many computers.
local MAX_LOGIN_FAILURES = 10
local LOGIN_FAILURE_WINDOW = "15 minutes"
local LOGIN_LOCK_TIME = "15 minutes"
local LOCKED_MESSAGE = "Too many wrong passwords for this email. Wait 15 minutes and try again."

-- A bcrypt salt (cost 12, like real passwords) for emails without an
-- account, so checking them takes as long as checking a real password.
local DUMMY_BCRYPT_SALT = "$2a$12$Q9oLmisVH0TiX56Skr46hO"

-- Counts one wrong password for an email. Returns true when that email is
-- now paused. Old counts (outside the window) start over at 1.
local function record_login_failure(email)
    local rows = database_query([[
        INSERT INTO public.auth_login_failures AS failure (email, failures, first_failed_at)
        VALUES ($1, 1, now())
        ON CONFLICT (email) DO UPDATE
        SET failures = CASE
                WHEN failure.first_failed_at < now() - $3::interval THEN 1
                ELSE failure.failures + 1
            END,
            first_failed_at = CASE
                WHEN failure.first_failed_at < now() - $3::interval THEN now()
                ELSE failure.first_failed_at
            END,
            locked_until = CASE
                WHEN failure.first_failed_at >= now() - $3::interval
                     AND failure.failures + 1 >= $2
                THEN now() + $4::interval
                ELSE NULL
            END
        RETURNING locked_until IS NOT NULL AS locked
    ]], email, MAX_LOGIN_FAILURES, LOGIN_FAILURE_WINDOW, LOGIN_LOCK_TIME)
    -- Forget failures from long ago so the table stays small.
    database_query([[
        DELETE FROM public.auth_login_failures
        WHERE first_failed_at < now() - interval '1 day'
          AND (locked_until IS NULL OR locked_until < now())
    ]])
    return rows and rows[1] and (rows[1].locked == true or rows[1].locked == "t") or false
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
    if body.rememberMe ~= nil and type(body.rememberMe) ~= "boolean" then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "Remember me must be enabled or disabled." })
    end

    local email = string.lower(body.email)

    -- Is this email paused after too many wrong passwords?
    local lock = database_query([[
        SELECT 1 FROM public.auth_login_failures
        WHERE email = $1 AND locked_until > now()
    ]], email)
    if not lock then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Sign-in is temporarily unavailable." })
    end
    if lock[1] then
        return respond(429, { error = LOCKED_MESSAGE })
    end

    -- Checks the password. The hashing (bcrypt) always runs, also when no
    -- account has this email: then it runs against a made-up salt. That
    -- way a wrong email takes as long as a wrong password, and the timing
    -- doesn't tell anyone which emails have an account.
    local rows = database_query([[
        SELECT account.id, account.email,
            crypt($2, COALESCE(account.password_hash, $3)) = account.password_hash AS password_ok
        FROM (SELECT 1) AS always_one_row
        LEFT JOIN public.auth_users AS account ON account.email = $1
    ]], email, body.password, DUMMY_BCRYPT_SALT)
    if not rows or not rows[1] then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Sign-in is temporarily unavailable." })
    end
    local account = rows[1]
    if account.password_ok ~= true and account.password_ok ~= "t" then
        local locked = record_login_failure(email)
        if locked then
            return respond(429, { error = LOCKED_MESSAGE })
        end
        return respond(ngx.HTTP_UNAUTHORIZED, { error = "Email or password is incorrect." })
    end
    database_query("DELETE FROM public.auth_login_failures WHERE email = $1", email)
    if not create_session(account.id, body.rememberMe == true) then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not start your session." })
    end
    return respond(ngx.HTTP_OK, {
        user = { email = account.email },
    })
end

local function handle_logout()
    if ngx.req.get_method() ~= "POST" then
        return respond(ngx.HTTP_NOT_ALLOWED, { error = "Only POST is supported." })
    end

    -- {"everywhere": true} signs out every device (for example a phone you
    -- lost, or a shared computer), not only this browser.
    local body = read_json_body() or {}
    local token = ngx.var.cookie_osiris_session
    if token and #token == 64 and token:match("^[%da-fA-F]+$") then
        local rows = database_query(body.everywhere == true and [[
            DELETE FROM public.auth_sessions
            WHERE user_id = (
                SELECT user_id FROM public.auth_sessions
                WHERE token_hash = encode(digest($1, 'sha256'), 'hex')
            )
        ]] or [[
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

-- Deletes your account and everything in it: goals, check-ins, follows,
-- shared trees, reminders and sessions (every table points at auth_users
-- with ON DELETE CASCADE). To be sure it's you and not a slip of the
-- finger, the browser must send your own email address back as "confirm".
local function handle_delete_account()
    if ngx.req.get_method() ~= "POST" then
        return respond(ngx.HTTP_NOT_ALLOWED, { error = "Only POST is supported." })
    end
    local user, database_error = current_user()
    if database_error then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Authentication is temporarily unavailable." })
    end
    if not user then
        return respond(ngx.HTTP_UNAUTHORIZED, { error = "Please sign in to continue." })
    end
    local body = read_json_body()
    if not body or type(body.confirm) ~= "string"
        or string.lower(body.confirm:match("^%s*(.-)%s*$")) ~= string.lower(user.email) then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "Type your email address to confirm." })
    end
    local rows = database_query([[
        DELETE FROM public.auth_users WHERE id = $1 RETURNING id
    ]], user.id)
    if not rows or not rows[1] then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not delete your account. Nothing was removed." })
    end
    clear_cookie(SESSION_COOKIE, "/")
    return respond(ngx.HTTP_OK, { ok = true })
end

local PROFILE_GENDERS = {
    ["Male"] = true,
    ["Female"] = true,
    ["Non-binary"] = true,
    ["Prefer not to say"] = true,
    ["Other"] = true,
}

local function profile_response(user)
    return {
        email = user.email,
        profile_picture = user.profile_picture or cjson.null,
        display_name = user.profile_display_name or "",
        gender = user.profile_gender or cjson.null,
        bio = user.profile_bio or "",
        goals = user.profile_goals or "",
        onboarding_seen = user.profile_onboarding_seen,
    }
end

local function handle_profile()
    local user, database_error = current_user()
    if database_error then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Authentication is temporarily unavailable." })
    end
    if not user then
        return respond(ngx.HTTP_UNAUTHORIZED, { error = "Please sign in to continue." })
    end

    local method = ngx.req.get_method()
    if method == "GET" then
        local rows = database_query([[
            SELECT email, profile_picture, profile_display_name, profile_gender, profile_bio, profile_goals, profile_onboarding_seen
            FROM public.auth_users
            WHERE id = $1
        ]], user.id)
        if not rows or not rows[1] then
            return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not load your profile." })
        end
        return respond(ngx.HTTP_OK, { profile = profile_response(rows[1]) })
    end

    if method ~= "POST" then
        return respond(ngx.HTTP_NOT_ALLOWED, { error = "Only GET and POST are supported." })
    end

    local body = read_json_body(200000)
    local display_name_count = body and type(body.displayName) == "string" and utf8_character_count(body.displayName)
    local bio_count = body and type(body.bio) == "string" and utf8_character_count(body.bio)
    local goals_count = body and type(body.goals) == "string" and utf8_character_count(body.goals)
    local valid_gender = body and type(body.gender) == "string"
        and (body.gender == "" or PROFILE_GENDERS[body.gender])
    local picture = body and body.profilePicture
    local valid_picture = picture == ""
        or (type(picture) == "string"
            and #picture <= 160000
            and picture:match("^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$") ~= nil)
    if not body or not display_name_count or display_name_count > 50
        or not valid_gender
        or not bio_count or bio_count > 250
        or not goals_count or goals_count > 1000
        or not valid_picture then
        return respond(ngx.HTTP_BAD_REQUEST, {
            error = "Check your profile details. Bio must be 250 characters or fewer and goals must be 1000 characters or fewer.",
        })
    end

    local rows = database_query([[
        UPDATE public.auth_users
        SET profile_picture = NULLIF($2, ''),
            profile_display_name = $3,
            profile_gender = NULLIF($4, ''),
            profile_bio = $5,
            profile_goals = $6,
            profile_onboarding_seen = true
        WHERE id = $1
        RETURNING email, profile_picture, profile_display_name, profile_gender, profile_bio, profile_goals, profile_onboarding_seen
    ]], user.id, picture, body.displayName, body.gender, body.bio, body.goals)
    if not rows or not rows[1] then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not save your profile." })
    end
    return respond(ngx.HTTP_OK, { profile = profile_response(rows[1]) })
end

local function handle_profile_skip()
    if ngx.req.get_method() ~= "POST" then
        return respond(ngx.HTTP_NOT_ALLOWED, { error = "Only POST is supported." })
    end
    local user, database_error = current_user()
    if database_error then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Authentication is temporarily unavailable." })
    end
    if not user then
        return respond(ngx.HTTP_UNAUTHORIZED, { error = "Please sign in to continue." })
    end

    local rows = database_query([[
        UPDATE public.auth_users
        SET profile_onboarding_seen = true
        WHERE id = $1
        RETURNING profile_onboarding_seen
    ]], user.id)
    if not rows or not rows[1] then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not skip profile setup." })
    end
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
        return ngx.redirect("/login?error=google-config", ngx.HTTP_MOVED_TEMPORARILY)
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

    -- Signs in, creates the account, or links Google to an account that
    -- was made with the same email and a password.
    --
    -- Linking needs care: Osiris doesn't check email addresses at sign-up,
    -- so someone could have made a password account with YOUR email before
    -- you ever came here, hoping you'd later use it through Google. Google
    -- has now proven the email is yours, so the first time Google is linked
    -- the old password is removed and every old session is signed out.
    -- From then on you sign in with Google (and nobody else has a way in).
    local rows = database_query([[
        WITH before AS (
            SELECT id FROM public.auth_users
            WHERE email = $1 AND google_sub IS NULL
        ),
        linked AS (
            INSERT INTO public.auth_users (email, google_sub)
            VALUES ($1, $2)
            ON CONFLICT (email) DO UPDATE
            SET google_sub = EXCLUDED.google_sub,
                password_hash = CASE
                    WHEN public.auth_users.google_sub IS NULL THEN NULL
                    ELSE public.auth_users.password_hash
                END
            WHERE public.auth_users.google_sub IS NULL
               OR public.auth_users.google_sub = EXCLUDED.google_sub
            RETURNING id
        ),
        signed_out AS (
            DELETE FROM public.auth_sessions
            WHERE user_id IN (SELECT id FROM before)
              AND EXISTS (SELECT 1 FROM linked)
            RETURNING user_id
        )
        SELECT id FROM linked
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

M.valid_email = valid_email
M.valid_password = valid_password
M.create_session = create_session
M.handle_signup = handle_signup
M.handle_login = handle_login
M.handle_logout = handle_logout
M.handle_delete_account = handle_delete_account
M.record_login_failure = record_login_failure
M.profile_response = profile_response
M.handle_profile = handle_profile
M.handle_profile_skip = handle_profile_skip
M.google_configuration = google_configuration
M.google_error_redirect = google_error_redirect
M.handle_google_start = handle_google_start
M.handle_google_callback = handle_google_callback
M.PROFILE_GENDERS = PROFILE_GENDERS

return M
