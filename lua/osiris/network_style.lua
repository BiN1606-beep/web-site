-- The /api/network-style endpoint: how your progress network looks.
--
-- The "Customize" button on the network (public/js/network-style.js) lets
-- you pick a shape, colors, a background, how hard the lines pull and how
-- the timelapse plays (its speed, and if it plays when you open Osiris). The
-- choice is saved on your account (auth_users.network_style) so it is the
-- same on every device. GET /api/progress-tree also sends it, so the
-- network is drawn in your style straight away.
--
-- Checking and saving is shared with the theme and fonts in Settings, see
-- lua/osiris/saved_look.lua. Only known keys and values are kept.

local saved_look = require "osiris.saved_look"
local M = {}

local network_style = saved_look.new({
    column = "network_style",
    name = "network style",
    -- The allowed choices. Keep these in step with STYLE_CHOICES in
    -- public/js/network-style.js.
    choices = {
        shape = { web = true, tree = true, galaxy = true, orbit = true, lines = true },
        palette = { areas = true, forest = true, sunset = true, ocean = true, ink = true },
        sky = { plain = true, dots = true, stars = true },
        -- How fast the timelapse replays your network growing.
        lapse = { slow = true, normal = true, fast = true, turbo = true },
    },
    -- Sliders are numbers from 0 to 1.
    sliders = { "pull", "spread", "dots" },
    -- On/off switches. "autoplay" plays the timelapse when you open Osiris,
    -- "together" grows all goal paths at the same time in the timelapse,
    -- "follow" zooms in and follows the growth.
    switches = { "curved", "names", "autoplay", "together", "follow" },
})

M.clean_style = network_style.clean
M.load_style = network_style.load
M.handle_network_style = network_style.handle

return M
