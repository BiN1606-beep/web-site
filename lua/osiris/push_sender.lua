-- Sends the daily check-in reminders and friends' nudges as web push
-- messages. It runs inside OpenResty itself, every 5 minutes, so the server
-- needs nothing extra installed (no Python, no systemd timer).
--
-- A push message must be encrypted for the receiving browser (RFC 8291,
-- "aes128gcm") and signed with our VAPID key (RFC 8292, an ES256 JSON Web
-- Token). Both are done here with lua-resty-openssl, which ships with
-- OpenResty. The browsers' push services are free.
--
-- How it is wired up in nginx.conf:
--   init_by_lua         load_key()  reads /etc/mysite/vapid_private.pem. This
--                       runs in the master process as root, so the key can
--                       stay readable by root only; the workers (user
--                       nobody) inherit the text in memory.
--   init_worker_by_lua  start()     runs run_once() every 5 minutes.
--
-- Rows are claimed in the database before anything is sent (last_sent_day
-- or pushed_at is set first), so two runs at the same time, for example
-- during a reload, never send the same reminder twice.

local M = {}

local cjson = require "cjson.safe"
local common = require "osiris.common"
local reminders = require "osiris.reminders"

local database_query = common.database_query

local PRIVATE_KEY_FILE = "/etc/mysite/vapid_private.pem"
local SUBJECT = "https://osiris-ai.se"
-- Drop the message if the phone stays offline for 12 hours.
local TTL_SECONDS = 12 * 60 * 60
local INTERVAL_SECONDS = 5 * 60

-- Only for tests/api/nginx.conf: an http:// address of a fake push service
-- that is accepted besides the real ones. Never set by the real site.
M.test_endpoint_prefix = nil

local private_key_pem = nil

-- ---- Small helpers ----

local function base64url_encode(raw)
    return (ngx.encode_base64(raw, true):gsub("%+", "-"):gsub("/", "_"))
end

local function base64url_decode(text)
    if type(text) ~= "string" then
        return nil
    end
    text = text:gsub("=+$", ""):gsub("-", "+"):gsub("_", "/")
    local padding = (4 - #text % 4) % 4
    if padding == 3 then
        return nil
    end
    return ngx.decode_base64(text .. string.rep("=", padding))
end

local function hmac_sha256(key, data)
    local hmac = require "resty.openssl.hmac"
    local mac, err = hmac.new(key, "sha256")
    if not mac then
        return nil, err
    end
    return mac:final(data)
end

-- The DER prefix of a P-256 public key in SubjectPublicKeyInfo form. Adding
-- it in front of a browser's raw 65-byte key lets OpenSSL load that key.
local P256_SPKI_PREFIX = ngx.decode_base64("MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgA=")

local function raw_public_key(pkey)
    local der = pkey:tostring("public", "DER")
    return der and der:sub(-65)
end

local function load_browser_key(raw)
    if type(raw) ~= "string" or #raw ~= 65 or raw:byte(1) ~= 4 then
        return nil, "bad browser key"
    end
    local pkey = require "resty.openssl.pkey"
    return pkey.new(P256_SPKI_PREFIX .. raw, { format = "DER", type = "pu" })
end

-- OpenSSL gives an ECDSA signature as DER (SEQUENCE of two INTEGERs); a JSON
-- Web Token needs the two numbers as 32 bytes each.
local function der_signature_to_raw(der)
    local function read_integer(position)
        if der:byte(position) ~= 2 then
            return nil
        end
        local length = der:byte(position + 1)
        local value = der:sub(position + 2, position + 1 + length)
        value = value:gsub("^%z+", "")
        if #value > 32 then
            return nil
        end
        return string.rep("\0", 32 - #value) .. value, position + 2 + length
    end
    if type(der) ~= "string" or der:byte(1) ~= 0x30 then
        return nil
    end
    local position = 3
    if der:byte(2) == 0x81 then
        position = 4
    end
    local r, next_position = read_integer(position)
    if not r then
        return nil
    end
    local s = read_integer(next_position)
    if not s then
        return nil
    end
    return r .. s
end

-- ---- VAPID (RFC 8292) ----

function M.load_key()
    local file = io.open(PRIVATE_KEY_FILE, "r")
    if not file then
        private_key_pem = nil
        return false
    end
    private_key_pem = file:read("*a")
    file:close()
    return true
end

local vapid_key = nil
local function get_vapid_key()
    if vapid_key then
        return vapid_key
    end
    if not private_key_pem then
        return nil, "no VAPID key loaded"
    end
    local pkey = require "resty.openssl.pkey"
    local key, err = pkey.new(private_key_pem)
    if not key then
        return nil, err
    end
    vapid_key = key
    return key
end

local function vapid_authorization(audience)
    local key, err = get_vapid_key()
    if not key then
        return nil, err
    end
    local header = base64url_encode(cjson.encode({ typ = "JWT", alg = "ES256" }))
    local claims = base64url_encode(cjson.encode({
        aud = audience,
        exp = ngx.time() + 12 * 60 * 60,
        sub = SUBJECT,
    }))
    local signing_input = header .. "." .. claims
    local der, sign_err = key:sign(signing_input, "sha256")
    if not der then
        return nil, sign_err
    end
    local raw = der_signature_to_raw(der)
    if not raw then
        return nil, "could not read the signature"
    end
    return "vapid t=" .. signing_input .. "." .. base64url_encode(raw)
        .. ", k=" .. base64url_encode(raw_public_key(key))
end

-- ---- Encryption (RFC 8291 with RFC 8188 aes128gcm) ----

-- Returns the encrypted body for one browser, or nil and an error.
-- salt and local_key can be passed by tests; normally they are random.
function M.encrypt(payload, p256dh, auth, salt, local_key)
    local pkey = require "resty.openssl.pkey"
    local cipher = require "resty.openssl.cipher"
    local rand = require "resty.openssl.rand"

    local browser_raw = base64url_decode(p256dh)
    local auth_secret = base64url_decode(auth)
    if not auth_secret or #auth_secret < 16 then
        return nil, "bad auth secret"
    end
    local browser_key, err = load_browser_key(browser_raw)
    if not browser_key then
        return nil, err
    end

    local own_key = local_key or pkey.new({ type = "EC", curve = "prime256v1" })
    local own_raw = raw_public_key(own_key)
    local shared_secret, derive_err = own_key:derive(browser_key)
    if not shared_secret then
        return nil, derive_err
    end

    -- Mix the shared secret with the browser's auth secret.
    local prk_key = hmac_sha256(auth_secret, shared_secret)
    local ikm = hmac_sha256(prk_key, "WebPush: info\0" .. browser_raw .. own_raw .. "\1")

    -- The content key and nonce for this message.
    salt = salt or rand.bytes(16)
    local prk = hmac_sha256(salt, ikm)
    local content_key = hmac_sha256(prk, "Content-Encoding: aes128gcm\0\1"):sub(1, 16)
    local nonce = hmac_sha256(prk, "Content-Encoding: nonce\0\1"):sub(1, 12)

    -- One record: the message, then the 0x02 "last record" delimiter.
    local aes = cipher.new("aes-128-gcm")
    local encrypted, encrypt_err = aes:encrypt(content_key, nonce, payload .. "\2", false)
    if not encrypted then
        return nil, encrypt_err
    end
    local tag = aes:get_aead_tag(16)

    -- Header: salt, record size (4096, big-endian), key length, our key.
    local header = salt .. "\0\0\16\0" .. string.char(#own_raw) .. own_raw
    return header .. encrypted .. tag
end

-- ---- Sending ----

local function allowed_endpoint(endpoint)
    if reminders.valid_push_endpoint(endpoint) then
        return true
    end
    local prefix = M.test_endpoint_prefix
    return type(prefix) == "string" and type(endpoint) == "string"
        and endpoint:sub(1, #prefix) == prefix
end

-- A minimal HTTP/1.1 POST over the nginx socket API. Returns the status
-- code, or nil and an error.
local function http_post(endpoint, headers, body)
    local scheme, host, port, path = endpoint:match("^(https?)://([%w%.%-]+):?(%d*)(/.*)$")
    if not scheme then
        return nil, "bad endpoint"
    end
    port = tonumber(port) or (scheme == "https" and 443 or 80)

    local socket = ngx.socket.tcp()
    socket:settimeouts(10000, 10000, 10000)
    local ok, err = socket:connect(host, port)
    if not ok then
        return nil, err
    end
    if scheme == "https" then
        ok, err = socket:sslhandshake(nil, host, true)
        if not ok then
            socket:close()
            return nil, err
        end
    end

    local lines = { "POST " .. path .. " HTTP/1.1", "Host: " .. host }
    for name, value in pairs(headers) do
        lines[#lines + 1] = name .. ": " .. value
    end
    lines[#lines + 1] = "Content-Length: " .. #body
    lines[#lines + 1] = "Connection: close"
    local request = table.concat(lines, "\r\n") .. "\r\n\r\n" .. body

    ok, err = socket:send(request)
    if not ok then
        socket:close()
        return nil, err
    end
    local status_line
    status_line, err = socket:receive("*l")
    socket:close()
    if not status_line then
        return nil, err
    end
    local status = tonumber(status_line:match("^HTTP/%d%.%d (%d%d%d)"))
    if not status then
        return nil, "bad response"
    end
    return status
end

-- Sends one message to one device. Returns "sent", "removed" or "failed".
local function send_push(subscription, message)
    if not allowed_endpoint(subscription.endpoint) then
        database_query("DELETE FROM public.push_subscriptions WHERE id = $1", subscription.id)
        return "removed"
    end
    local body, err = M.encrypt(cjson.encode(message), subscription.p256dh, subscription.auth)
    if not body then
        -- The browser gave keys we cannot use; it can subscribe again.
        ngx.log(ngx.WARN, "Push to subscription ", subscription.id, " has unusable keys: ", err)
        database_query("DELETE FROM public.push_subscriptions WHERE id = $1", subscription.id)
        return "removed"
    end
    local audience = subscription.endpoint:match("^(https?://[^/]+)")
    local authorization, auth_err = vapid_authorization(audience)
    if not authorization then
        ngx.log(ngx.ERR, "Could not sign a push message: ", auth_err)
        return "failed"
    end
    local status, post_err = http_post(subscription.endpoint, {
        ["Authorization"] = authorization,
        ["Content-Encoding"] = "aes128gcm",
        ["Content-Type"] = "application/octet-stream",
        ["TTL"] = tostring(TTL_SECONDS),
        ["Urgency"] = "normal",
    }, body)
    if status and status >= 200 and status < 300 then
        return "sent"
    end
    if status == 404 or status == 410 then
        -- The browser unsubscribed or the app was removed.
        database_query("DELETE FROM public.push_subscriptions WHERE id = $1", subscription.id)
        return "removed"
    end
    ngx.log(ngx.WARN, "Push to subscription ", subscription.id, " failed: ", status or post_err)
    return "failed"
end

local function reminder_text(days_since)
    days_since = tonumber(days_since)
    if not days_since then
        return "Your first check-in is waiting", "Take one minute: write what you did on your goal today."
    end
    if days_since <= 1 then
        return "Keep your streak alive", "You haven't checked in today. One line is enough."
    end
    return "Your network misses you", "It's been a few days. One check-in today gets you back on track."
end

-- Claims the subscriptions that are due now: the local hour has reached
-- remind_hour, nothing was sent today (local), the user has a goal and
-- hasn't checked in today. Today's date is saved before sending; a failed
-- send puts back the previous date so the next run tries again.
local CLAIM_DUE_SUBSCRIPTIONS = [[
    UPDATE public.push_subscriptions s
    SET last_sent_day = (now() AT TIME ZONE s.timezone)::date
    FROM (
        SELECT id, last_sent_day AS previous_day
        FROM public.push_subscriptions s
        WHERE extract(hour FROM now() AT TIME ZONE s.timezone) >= s.remind_hour
          AND s.last_sent_day IS DISTINCT FROM (now() AT TIME ZONE s.timezone)::date
          AND EXISTS (
              SELECT 1 FROM public.user_progress_trees t
              WHERE t.user_id = s.user_id AND t.tree_data IS NOT NULL
          )
          AND NOT EXISTS (
              SELECT 1 FROM public.daily_checkins c
              WHERE c.user_id = s.user_id
                AND c.day = (now() AT TIME ZONE s.timezone)::date
          )
        ORDER BY id
        LIMIT 1000
        FOR UPDATE SKIP LOCKED
    ) due
    WHERE s.id = due.id
    RETURNING s.id, s.endpoint, s.p256dh, s.auth,
        to_char(due.previous_day, 'YYYY-MM-DD') AS previous_day,
        (now() AT TIME ZONE s.timezone)::date
            - (SELECT max(c.day) FROM public.daily_checkins c WHERE c.user_id = s.user_id) AS days_since
]]

-- Claims nudges from a friend ("hop on and check in!") that have not
-- reached the phone yet. Older than 12 hours is too late to be useful, so
-- those are only marked, never sent.
local CLAIM_PENDING_NUDGES = [[
    UPDATE public.shared_tree_nudges nudge
    SET pushed_at = now()
    FROM (
        SELECT tree_id, from_user, day
        FROM public.shared_tree_nudges
        WHERE pushed_at IS NULL
        ORDER BY created_at
        LIMIT 500
        FOR UPDATE SKIP LOCKED
    ) due,
    public.shared_trees tree,
    public.auth_users sender
    WHERE nudge.tree_id = due.tree_id AND nudge.from_user = due.from_user AND nudge.day = due.day
      AND tree.id = nudge.tree_id AND sender.id = nudge.from_user
    RETURNING nudge.tree_id, nudge.to_user,
        COALESCE(NULLIF(sender.profile_display_name, ''), sender.profile_username, 'Your friend') AS sender_name,
        tree.title,
        nudge.created_at > now() - interval '12 hours' AS fresh
]]

local function send_reminders(counts)
    local due = database_query(CLAIM_DUE_SUBSCRIPTIONS)
    if not due then
        counts.failed = counts.failed + 1
        return
    end
    for _, subscription in ipairs(due) do
        local title, body = reminder_text(subscription.days_since)
        local result = send_push(subscription, { title = title, body = body })
        counts[result] = counts[result] + 1
        if result == "failed" then
            database_query([[
                UPDATE public.push_subscriptions SET last_sent_day = NULLIF($2, '')::date WHERE id = $1
            ]], subscription.id, subscription.previous_day or "")
        end
    end
end

local function send_nudges(counts)
    local nudges = database_query(CLAIM_PENDING_NUDGES)
    if not nudges then
        counts.failed = counts.failed + 1
        return
    end
    for _, nudge in ipairs(nudges) do
        -- Marked even when it is stale or the friend has no phone set up:
        -- the nudge is still in their inbox on the site.
        if nudge.fresh then
            local message = {
                title = nudge.sender_name .. " is waiting for you",
                body = "Hop on and check in on \226\128\156" .. nudge.title .. "\226\128\157 so your network can grow today.",
                tag = "osiris-nudge-" .. nudge.tree_id,
            }
            local subscriptions = database_query([[
                SELECT id, endpoint, p256dh, auth FROM public.push_subscriptions WHERE user_id = $1
            ]], nudge.to_user) or {}
            for _, subscription in ipairs(subscriptions) do
                local result = send_push(subscription, message)
                counts[result] = counts[result] + 1
            end
        end
    end
end

-- One pass: friends' nudges first, then the daily reminders. Returns the
-- counts, or nil and a reason when reminders are not set up.
function M.run_once()
    if not private_key_pem then
        return nil, "no VAPID key"
    end
    local counts = { sent = 0, removed = 0, failed = 0 }
    send_nudges(counts)
    send_reminders(counts)
    if counts.sent + counts.removed + counts.failed > 0 then
        ngx.log(ngx.NOTICE, "Push messages: ", counts.sent, " sent, ",
            counts.removed, " removed, ", counts.failed, " failed")
    end
    return counts
end

local running = false
local function tick(premature)
    if premature or running then
        return
    end
    running = true
    local ok, err = pcall(M.run_once)
    running = false
    if not ok then
        ngx.log(ngx.ERR, "Push sender failed: ", err)
    end
end

function M.start()
    if ngx.worker.id() ~= 0 then
        return
    end
    if not private_key_pem then
        ngx.log(ngx.NOTICE, "Reminders are off: no key at ", PRIVATE_KEY_FILE)
        return
    end
    ngx.timer.at(30, tick)
    local ok, err = ngx.timer.every(INTERVAL_SECONDS, tick)
    if not ok then
        ngx.log(ngx.ERR, "Could not start the push sender: ", err)
    end
end

M.base64url_encode = base64url_encode
M.base64url_decode = base64url_decode
M.der_signature_to_raw = der_signature_to_raw
M.http_post = http_post

return M
