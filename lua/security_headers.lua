-- Security headers for every reply the site sends (pages, API answers,
-- files and error pages). nginx.conf runs apply() from
-- header_filter_by_lua_block at the server level.
--
-- Why a Lua filter instead of nginx's "add_header"? In nginx a location
-- with its own add_header (for example Cache-Control) silently drops every
-- add_header from the server level. This filter runs for every location, so
-- no page can forget the headers.
--
-- What each header does:
--   Strict-Transport-Security  Browsers only ever use HTTPS for this site
--                              for a year, so nobody on the same Wi-Fi can
--                              downgrade a visit to plain HTTP and read the
--                              session cookie.
--   Content-Security-Policy    Which sources the page may load code and
--                              styles from. Scripts only come from this site
--                              (no inline scripts), so even if someone
--                              managed to sneak HTML into a name or a note,
--                              the browser refuses to run it.
--   X-Frame-Options / frame-ancestors
--                              No other site can show Osiris inside a frame
--                              and trick people into clicking (clickjacking).
--   X-Content-Type-Options     Browsers trust the content type we send
--                              instead of guessing.
--   Referrer-Policy            Other sites only learn "osiris-ai.se", never
--                              the full address someone came from.
--   Permissions-Policy         Turns off browser features Osiris never uses
--                              (camera, microphone, location, payments...).
--   Cross-Origin-Opener-Policy Other sites that open Osiris in a popup get no
--                              handle on its window.

local M = {}

-- Where the page may load things from. 'self' is osiris-ai.se itself.
-- Google Fonts serves the fonts (the stylesheet from fonts.googleapis.com,
-- the font files from fonts.gstatic.com). Inline style attributes stay
-- allowed because d3 and the theme code set colors and positions that way;
-- styles cannot run code, so this is a small risk.
local CONTENT_SECURITY_POLICY = table.concat({
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
}, "; ")

local PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), "
    .. "magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()"

function M.apply()
    local header = ngx.header
    if ngx.var.scheme == "https" then
        header["Strict-Transport-Security"] = "max-age=31536000"
    end
    header["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    header["X-Frame-Options"] = "DENY"
    header["X-Content-Type-Options"] = "nosniff"
    header["Referrer-Policy"] = "strict-origin-when-cross-origin"
    header["Permissions-Policy"] = PERMISSIONS_POLICY
    header["Cross-Origin-Opener-Policy"] = "same-origin"
end

return M
