-- Site-wide safety rules: the security headers every reply carries, the
-- check that changes come from Osiris's own pages, and the limit on wrong
-- passwords for one account.
--
-- Why each one matters, in short:
--  * Security headers tell the browser to only ever use HTTPS, to refuse
--    scripts that did not come from Osiris (so injected text can never run
--    as code), and to never show Osiris inside another site's frame (so no
--    one can trick a click on a hidden Osiris button).
--  * The same-origin check stops another website from making a signed-in
--    visitor's browser change things on Osiris (cross-site request forgery).
--    The SameSite=Lax cookie already blocks this in modern browsers; this is
--    a second lock on the same door.
--  * The wrong-password limit stops someone guessing one account's password
--    from many different IP addresses (nginx already limits each IP).

local M = {}

-- What a page may load, and from where. 'self' means osiris-ai.se itself.
--  * script-src: only our own /js files and the d3 library on cdnjs. No
--    inline scripts, so a name or bio containing <script> can never run.
--  * style-src: 'unsafe-inline' stays because the pages use style="" and
--    <style> blocks; styles cannot run code, so the risk is small.
--  * img-src data: is needed for profile pictures (stored as data: URLs).
--  * frame-ancestors 'none': no other site may put Osiris in a frame.
--  * form-action / base-uri: forms and relative links can't be pointed
--    somewhere else by injected HTML.
local CONTENT_SECURITY_POLICY = table.concat({
    "default-src 'self'",
    "script-src 'self' https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
}, "; ")

-- Runs for every reply (header_filter_by_lua in nginx.conf).
function M.add_headers()
    local header = ngx.header
    -- Browsers remember for a year to only use HTTPS for osiris-ai.se, so
    -- nobody on a café Wi-Fi can quietly downgrade a visit to plain HTTP.
    header["Strict-Transport-Security"] = "max-age=31536000"
    header["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    header["X-Frame-Options"] = "DENY"
    header["X-Content-Type-Options"] = "nosniff"
    header["Referrer-Policy"] = "strict-origin-when-cross-origin"
    header["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    header["Cross-Origin-Opener-Policy"] = "same-origin"
end

local SAFE_METHODS = { GET = true, HEAD = true, OPTIONS = true }

-- True when a request that changes something came from an Osiris page.
-- Browsers always send Origin (and Sec-Fetch-Site) with fetch() POSTs, so a
-- request from another site shows up here as a different origin. Requests
-- with neither header (curl, the tests) are let through: they carry no
-- visitor's cookies unless whoever sends them already has them.
function M.same_origin_request()
    if SAFE_METHODS[ngx.req.get_method()] then
        return true
    end
    local fetch_site = ngx.var.http_sec_fetch_site
    if fetch_site and fetch_site ~= "same-origin" and fetch_site ~= "none" then
        return false
    end
    local origin = ngx.var.http_origin
    if not origin then
        return true
    end
    local host = ngx.var.http_host
    if not host then
        return false
    end
    return origin == "https://" .. host or origin == "http://" .. host
end

-- ---- Wrong-password limit ----
-- Counts failed sign-ins per email in a small shared memory area
-- (lua_shared_dict login_failures in nginx.conf). After MAX_FAILURES wrong
-- passwords within LOCK_SECONDS, that email can't sign in with a password
-- until the window ends. Google sign-in still works. Nothing is written to
-- the database, and a server restart clears the counts.
local MAX_FAILURES = 10
local LOCK_SECONDS = 15 * 60

local function failures_store()
    return ngx.shared and ngx.shared.login_failures
end

function M.login_locked(email)
    local store = failures_store()
    if not store then
        return false
    end
    return (store:get(email) or 0) >= MAX_FAILURES
end

function M.record_login_failure(email)
    local store = failures_store()
    if not store then
        return
    end
    -- The window starts at the first failure and is not extended by later
    -- ones, so a lockout always ends LOCK_SECONDS after it began.
    store:incr(email, 1, 0, LOCK_SECONDS)
end

function M.clear_login_failures(email)
    local store = failures_store()
    if store then
        store:delete(email)
    end
end

M.CONTENT_SECURITY_POLICY = CONTENT_SECURITY_POLICY
M.MAX_FAILURES = MAX_FAILURES

return M
