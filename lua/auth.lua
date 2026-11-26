-- Entry point for nginx.conf: require("auth").handle_request() for every
-- API path, and the session checks for pages. The work happens in the
-- modules under lua/osiris/; this file only routes each path to one.

local M = {}
local common = require "osiris.common"
local accounts = require "osiris.accounts"
local progress = require "osiris.progress"
local community = require "osiris.community"
local stats = require "osiris.stats"
local devtools = require "osiris.devtools"
local network_style = require "osiris.network_style"
local appearance = require "osiris.appearance"
local routines = require "osiris.routines"

local respond = common.respond
local current_user = common.current_user
local handle_signup = accounts.handle_signup
local handle_login = accounts.handle_login
local handle_logout = accounts.handle_logout
local handle_profile = accounts.handle_profile
local handle_profile_skip = accounts.handle_profile_skip
local handle_google_start = accounts.handle_google_start
local handle_google_callback = accounts.handle_google_callback
local handle_progress_tree = progress.handle_progress_tree
local handle_community = community.handle_community

function M.require_page_session()
    local user, database_error = current_user()
    if database_error then
        ngx.status = ngx.HTTP_SERVICE_UNAVAILABLE
        ngx.say("Authentication is temporarily unavailable.")
        return ngx.exit(ngx.HTTP_SERVICE_UNAVAILABLE)
    end
    if not user then
        -- Visitors who open the home page see what Osiris is first; other
        -- pages go straight to sign-in.
        local uri = ngx.var.uri
        if uri == "/" or uri == "/index.html" then
            ngx.redirect("/welcome", ngx.HTTP_MOVED_TEMPORARILY)
        else
            ngx.redirect("/login", ngx.HTTP_MOVED_TEMPORARILY)
        end
        return false
    end
    ngx.ctx.auth_user = user
    return true
end

function M.require_api_session()
    if not common.same_origin_request() then
        respond(ngx.HTTP_FORBIDDEN, { error = "This request came from another website, so it was blocked." })
        return false
    end
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

function M.handle_request()
    local path = ngx.var.uri
    -- Every change must come from an Osiris page (see same_origin_request
    -- in lua/osiris/common.lua).
    if not common.same_origin_request() then
        return respond(ngx.HTTP_FORBIDDEN, { error = "This request came from another website, so it was blocked." })
    end
    if path == "/api/auth/signup" then
        return handle_signup()
    elseif path == "/api/auth/login" then
        return handle_login()
    elseif path == "/api/auth/logout" then
        return handle_logout()
    elseif path == "/api/auth/delete-account" then
        return accounts.handle_delete_account()
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
    elseif path == "/api/auth/profile" then
        return handle_profile()
    elseif path == "/api/auth/profile/skip" then
        return handle_profile_skip()
    elseif path == "/api/progress-tree" then
        return handle_progress_tree()
    elseif path == "/api/community" then
        return handle_community()
    elseif path == "/api/network-style" then
        return network_style.handle_network_style()
    elseif path == "/api/appearance" then
        return appearance.handle_appearance()
    elseif path == "/api/routines" then
        return routines.handle_routines()
    elseif path == "/api/stats" then
        return stats.handle_stats()
    elseif path == "/api/dev" then
        return devtools.handle_dev()
    elseif path == "/api/auth/google" then
        return handle_google_start()
    elseif path == "/api/auth/google/callback" then
        return handle_google_callback()
    end
    return respond(ngx.HTTP_NOT_FOUND, { error = "Authentication endpoint not found." })
end

return M
