-- The /api/appearance endpoint: your color theme and fonts.
--
-- Settings > Appearance (public/js/appearance.js) lets you pick a color
-- theme (Osiris paper, the four Catppuccin flavors, Nord and more), a font
-- for headings and a font for text. It is saved on your account
-- (auth_users.appearance) so the site looks the same on every device, and
-- GET /api/progress-tree sends it along with your goals.
--
-- Checking and saving works exactly like the network style, see
-- lua/osiris/saved_look.lua.

local saved_look = require "osiris.saved_look"
local M = {}

-- Keep these lists in step with APPEARANCE_THEMES and APPEARANCE_FONTS in
-- public/js/appearance.js.
local THEMES = {
    "osiris", "latte", "frappe", "macchiato", "mocha",
    "nord", "gruvbox", "rose-pine", "solarized", "tokyo-night", "everforest",
}
local TEXT_FONTS = {
    "ibm-plex-sans", "jetbrains-mono-nerd", "inter", "nunito", "lexend",
    "atkinson", "space-grotesk", "outfit", "fraunces", "playfair", "lora",
    "merriweather", "source-serif", "fira-code", "space-mono", "comic-neue",
}
-- Headings can also use the two playful fonts that are too hard to read
-- in long text.
local HEADING_FONTS = { "caveat", "press-start" }
for _, font in ipairs(TEXT_FONTS) do
    table.insert(HEADING_FONTS, font)
end

local function as_set(list)
    local set = {}
    for _, value in ipairs(list) do
        set[value] = true
    end
    return set
end

local appearance = saved_look.new({
    column = "appearance",
    name = "appearance",
    choices = {
        theme = as_set(THEMES),
        heading_font = as_set(HEADING_FONTS),
        text_font = as_set(TEXT_FONTS),
    },
})

M.load_appearance = appearance.load
M.handle_appearance = appearance.handle

return M
