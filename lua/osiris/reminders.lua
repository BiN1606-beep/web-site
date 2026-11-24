-- Daily reminders (web push): the public key, accepted push services, and turning reminders on and off.
--
-- Part of the server code that auth.lua used to hold in one file. Each
-- module returns a table M with its functions; the names a module
-- borrows from another module are listed at the top.

local M = {}
local common = require "osiris.common"

local respond = common.respond
local database_query = common.database_query

-- ---- Reminders (web push) ----

-- The public half of the VAPID key pair that signs our push messages. The
-- browser needs it to subscribe. deploy.sh copies it here from
-- /etc/mysite/vapid_public.txt (made once by reminders/setup.sh). Without
-- it, reminders are simply not offered.
local function vapid_public_key()
    local file = io.open("/opt/mysite/lua/vapid_public_key.txt", "r")
    if not file then
        return nil
    end
    local key = file:read("*a")
    file:close()
    key = type(key) == "string" and key:match("^%s*([%w_%-]+)%s*$") or nil
    return key and #key >= 80 and #key <= 100 and key or nil
end

-- The server will send requests to the endpoint a browser gives us, so only
-- the real push services are accepted (otherwise anyone could make our
-- server call any address). reminders/send_reminders.py checks again.
local PUSH_SERVICE_HOSTS = {
    "^fcm%.googleapis%.com$",
    "^updates%.push%.services%.mozilla%.com$",
    "^[%w%-]+%.push%.apple%.com$",
    "^[%w%-]+%.notify%.windows%.com$",
}

local function valid_push_endpoint(endpoint)
    if type(endpoint) ~= "string" or #endpoint > 1000 then
        return false
    end
    local host = endpoint:match("^https://([%w%.%-]+)/")
    if not host then
        return false
    end
    host = host:lower()
    for _, pattern in ipairs(PUSH_SERVICE_HOSTS) do
        if host:match(pattern) then
            return true
        end
    end
    return false
end

local function valid_base64url(value, max_length)
    return type(value) == "string" and #value > 0 and #value <= max_length
        and value:match("^[%w_%-]+=*$") ~= nil
end

-- A user can have reminders on several devices, but not unlimited.
local MAX_PUSH_SUBSCRIPTIONS = 10

-- Turn daily reminders on for this device (or change the hour).
function M.subscribe(user, body)
    if not vapid_public_key() then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Reminders are not set up on this server yet." })
    end
    local subscription = type(body.subscription) == "table" and body.subscription or {}
    local keys = type(subscription.keys) == "table" and subscription.keys or {}
    if not valid_push_endpoint(subscription.endpoint)
        or not valid_base64url(keys.p256dh, 200)
        or not valid_base64url(keys.auth, 100) then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "This browser's notification service is not supported." })
    end
    local hour = tonumber(body.hour)
    if not hour or hour < 0 or hour > 23 or hour % 1 ~= 0 then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "Choose an hour for your reminder." })
    end
    if type(body.timezone) ~= "string" or #body.timezone == 0 or #body.timezone > 64 then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "Your time zone could not be detected." })
    end
    -- One statement: save (or move to this user) the subscription, but
    -- only with a time zone PostgreSQL knows, then keep the newest
    -- MAX_PUSH_SUBSCRIPTIONS for this user.
    local saved = database_query([[
        WITH saved AS (
            INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, timezone, remind_hour)
            SELECT $1, $2, $3, $4, $5, $6
            WHERE EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = $5)
            ON CONFLICT (endpoint) DO UPDATE
                SET user_id = EXCLUDED.user_id,
                    p256dh = EXCLUDED.p256dh,
                    auth = EXCLUDED.auth,
                    timezone = EXCLUDED.timezone,
                    remind_hour = EXCLUDED.remind_hour,
                    updated_at = now()
            RETURNING id
        ),
        trimmed AS (
            DELETE FROM public.push_subscriptions
            WHERE user_id = $1
              AND id NOT IN (SELECT id FROM saved)
              AND id NOT IN (
                  SELECT id FROM public.push_subscriptions
                  WHERE user_id = $1
                  ORDER BY updated_at DESC, id DESC
                  LIMIT $7 - 1
              )
        )
        SELECT id FROM saved
    ]], user.id, subscription.endpoint, keys.p256dh, keys.auth, body.timezone, hour, MAX_PUSH_SUBSCRIPTIONS)
    if not saved then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not save your reminder." })
    end
    if not saved[1] then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "Your time zone is not recognized." })
    end
    return respond(ngx.HTTP_OK, { reminders = true, hour = hour })
end

-- Turn daily reminders off for this device.
function M.unsubscribe(user, body)
    if type(body.endpoint) ~= "string" or #body.endpoint > 1000 then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "Unknown reminder." })
    end
    if not database_query([[
        DELETE FROM public.push_subscriptions WHERE user_id = $1 AND endpoint = $2
    ]], user.id, body.endpoint) then
        return respond(ngx.HTTP_SERVICE_UNAVAILABLE, { error = "Could not turn off your reminder." })
    end
    return respond(ngx.HTTP_OK, { reminders = false })
end

M.vapid_public_key = vapid_public_key
M.valid_push_endpoint = valid_push_endpoint
M.valid_base64url = valid_base64url
M.PUSH_SERVICE_HOSTS = PUSH_SERVICE_HOSTS
M.MAX_PUSH_SUBSCRIPTIONS = MAX_PUSH_SUBSCRIPTIONS

return M
