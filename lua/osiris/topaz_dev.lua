-- Dev tools for topaz and orbs (owner accounts only, see
-- lua/osiris/devtools.lua, which checks the account before any of these
-- run). A "Topaz" card in the panel's Extras tab: your wallet and orbs,
-- and buttons to get an orb, reset today's orbs and set the wallet.
--
-- This lives in its own file because topaz.lua is loaded by goals.lua,
-- and devtools.lua loads goals.lua too: putting it in topaz.lua would make
-- the modules load each other in a circle.

local M = {}
local common = require "osiris.common"
local devtools = require "osiris.devtools"

local database_query = common.database_query

devtools.add_section(function(user, today)
    local rows = database_query([[
        SELECT COALESCE((SELECT balance FROM public.topaz_wallets WHERE user_id = $1), 0) AS balance,
               (SELECT count(*) FROM public.topaz_orbs
                WHERE user_id = $1 AND opened_at IS NULL) AS waiting,
               (SELECT count(*) FROM public.topaz_orbs
                WHERE user_id = $1 AND day = $2::date) AS today,
               (SELECT count(*) FROM public.topaz_orbs
                WHERE user_id = $1 AND opened_at IS NOT NULL) AS opened
    ]], user.id, today)
    local counts = rows and rows[1] or {}
    return {
        id = "topaz",
        title = "Topaz and orbs",
        stats = {
            { label = "Topaz", value = tonumber(counts.balance) or 0 },
            { label = "Orbs to open", value = tonumber(counts.waiting) or 0 },
            { label = "Orbs today", value = tonumber(counts.today) or 0 },
            { label = "Opened ever", value = tonumber(counts.opened) or 0 },
        },
        actions = {
            { action = "orb_grant", label = "Give me an orb" },
            { action = "orb_reset_today", label = "Reset today's orbs" },
            { action = "topaz_add", label = "+400 topaz", amount = 400 },
            { action = "topaz_zero", label = "Topaz to 0", danger = true },
        },
    }
end)

-- A fresh, closed orb with a real random amount, like a daily task gives.
devtools.add_action("orb_grant", function(user, _, today)
    local done = database_query([[
        INSERT INTO public.topaz_orbs (user_id, day, reason, ref_id, amount)
        SELECT $1, $2::date, 'dev',
               COALESCE((SELECT max(ref_id) FROM public.topaz_orbs
                         WHERE user_id = $1 AND day = $2::date AND reason = 'dev'), 0) + 1,
               public.topaz_orb_amount()
    ]], user.id, today)
    return done ~= nil, "An orb is waiting for you", { reload = true }
end)

-- Takes back today's orbs (and the topaz from the ones you opened), then
-- gives a new closed one for today's check-in if you did it. That way the
-- daily orb can be opened again and again while testing.
devtools.add_action("orb_reset_today", function(user, _, today)
    local done = database_query([[
        WITH gone AS (
            DELETE FROM public.topaz_orbs WHERE user_id = $1 AND day = $2::date
            RETURNING id
        ), unpaid AS (
            DELETE FROM public.topaz_earnings earning
            USING gone
            WHERE earning.user_id = $1 AND earning.reason = 'orb' AND earning.ref_id = gone.id
            RETURNING earning.amount
        )
        UPDATE public.topaz_wallets
        SET balance = GREATEST(0, balance - COALESCE((SELECT sum(amount) FROM unpaid), 0))
        WHERE user_id = $1
    ]], user.id, today)
    if done == nil then
        return false
    end
    done = database_query([[
        INSERT INTO public.topaz_orbs (user_id, day, reason, ref_id, amount)
        SELECT $1, $2::date, 'checkin', 0, public.topaz_orb_amount()
        WHERE EXISTS (SELECT 1 FROM public.daily_checkins WHERE user_id = $1 AND day = $2::date)
        ON CONFLICT DO NOTHING
    ]], user.id, today)
    return done ~= nil, "Today's orbs are reset", { reload = true }
end)

local function set_wallet(user, sql, amount)
    return database_query([[
        INSERT INTO public.topaz_wallets (user_id, balance) VALUES ($1, GREATEST(0, $2))
        ON CONFLICT (user_id) DO UPDATE SET balance = ]] .. sql, user.id, amount)
end

devtools.add_action("topaz_add", function(user, body)
    local amount = tonumber(body.amount) or 400
    if amount % 1 ~= 0 or amount < 1 or amount > 100000 then
        return false, "Pick a whole amount"
    end
    local done = set_wallet(user, "topaz_wallets.balance + EXCLUDED.balance", amount)
    return done ~= nil, "+" .. amount .. " topaz", { reload = true }
end)

devtools.add_action("topaz_zero", function(user)
    local done = set_wallet(user, "0", 0)
    return done ~= nil, "Topaz set to 0", { reload = true }
end)

return M
