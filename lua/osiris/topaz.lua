-- Topaz: yellow gems you earn by checking in and spend on streak freezes.
--
-- The earning happens in the database (see db/migrations/015_topaz_gems.sql):
-- every new check-in, on your own goal or a shared one, pays out once per
-- day. This module reads the wallet and handles buying a freeze.
--
-- Part of the server code that auth.lua used to hold in one file. Each
-- module returns a table M with its functions; the names a module
-- borrows from another module are listed at the top.

local M = {}
local common = require "osiris.common"

local database_query = common.database_query
local decode_json_value = common.decode_json_value

-- Keep these in step with the migration (the payouts) and with
-- public/js/streak.js (the freeze replay).
local FREEZE_PRICE = 70
local MAX_BOUGHT_FREEZES = 3
local PER_CHECKIN = 10
local MAX_SHARED_PER_DAY = 3

-- "YYYY-MM-DD" as a whole day number (days since 1970-01-01), so days can
-- be counted without time zones. This is the well-known "days from civil"
-- formula; it works for every Gregorian date.
local function day_number(day)
    local year, month, date = day:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)$")
    year, month, date = tonumber(year), tonumber(month), tonumber(date)
    if month <= 2 then
        year = year - 1
    end
    local era = math.floor(year / 400)
    local year_of_era = year - era * 400
    local day_of_year = math.floor((153 * (month + (month > 2 and -3 or 9)) + 2) / 5) + date - 1
    local day_of_era = year_of_era * 365 + math.floor(year_of_era / 4) - math.floor(year_of_era / 100) + day_of_year
    return era * 146097 + day_of_era - 719468
end

-- How many bought freezes are still unused on "today". This is the same
-- replay as computeStreak in public/js/streak.js, only counting what the
-- server needs: earned freezes (one every 7 days in a row, hold 2) are used
-- first, a bought one only when none is left, and a freeze is only used
-- while there is a streak to save.
local function bought_freezes_left(checkin_days, purchase_days, today)
    local today_number = day_number(today)
    local checked = {}
    local first
    for _, day in ipairs(checkin_days) do
        local number = day_number(day)
        if number <= today_number then
            checked[number] = true
            if not first or number < first then
                first = number
            end
        end
    end
    local bought_on = {}
    for _, day in ipairs(purchase_days) do
        local number = day_number(day)
        bought_on[number] = (bought_on[number] or 0) + 1
    end
    if not first then
        -- No streak yet, so nothing was ever used.
        return #purchase_days
    end
    local bought = 0
    for number, count in pairs(bought_on) do
        if number < first then
            bought = bought + count
        end
    end
    local earned, current = 0, 0
    for number = first, today_number do
        bought = bought + (bought_on[number] or 0)
        if checked[number] then
            current = current + 1
            if current % 7 == 0 then
                earned = math.min(2, earned + 1)
            end
        elseif number == today_number then
            -- Today is still open.
            break
        elseif current > 0 and earned > 0 then
            earned = earned - 1
        elseif current > 0 and bought > 0 then
            bought = bought - 1
        else
            current = 0
        end
    end
    return bought
end

-- The wallet as the browser sees it. A failed load shows 0 gems and no
-- bought freezes rather than breaking the page.
local function load_topaz(user_id)
    local rows = database_query([[
        SELECT
            COALESCE((SELECT balance FROM public.topaz_wallets WHERE user_id = $1), 0) AS balance,
            COALESCE((SELECT json_agg(day::text ORDER BY day) FROM public.freeze_purchases
                      WHERE user_id = $1), '[]') AS purchases
    ]], user_id)
    local row = rows and rows[1]
    local purchases = row and decode_json_value(row.purchases, {}) or {}
    if type(purchases) ~= "table" then
        purchases = {}
    end
    return {
        balance = row and tonumber(row.balance) or 0,
        purchases = purchases,
        freeze_price = FREEZE_PRICE,
        max_bought = MAX_BOUGHT_FREEZES,
        per_checkin = PER_CHECKIN,
        max_shared_per_day = MAX_SHARED_PER_DAY,
    }
end

-- Buys one streak freeze for FREEZE_PRICE topaz. checkins are the user's
-- check-ins ({ day = ... }) and day their local date. Returns "ok",
-- "full" (already holding the most bought freezes), "poor" (not enough
-- topaz or a day too far from today) or nil on a database error.
local function buy_freeze(user_id, day, checkins)
    local wallet = load_topaz(user_id)
    local checkin_days = {}
    for _, checkin in ipairs(checkins or {}) do
        checkin_days[#checkin_days + 1] = checkin.day
    end
    if bought_freezes_left(checkin_days, wallet.purchases, day) >= MAX_BOUGHT_FREEZES then
        return "full"
    end
    -- Paying and adding the freeze happen in one statement: if the wallet
    -- doesn't have enough, nothing is inserted.
    local rows = database_query([[
        WITH paid AS (
            UPDATE public.topaz_wallets
            SET balance = balance - $3
            WHERE user_id = $1 AND balance >= $3
              AND $2::date BETWEEN (now() AT TIME ZONE 'UTC')::date - 1
                               AND (now() AT TIME ZONE 'UTC')::date + 1
            RETURNING user_id
        )
        INSERT INTO public.freeze_purchases (user_id, day, price)
        SELECT user_id, $2::date, $3 FROM paid
        RETURNING id
    ]], user_id, day, FREEZE_PRICE)
    if not rows then
        return nil
    end
    return rows[1] and "ok" or "poor"
end

M.FREEZE_PRICE = FREEZE_PRICE
M.MAX_BOUGHT_FREEZES = MAX_BOUGHT_FREEZES
M.day_number = day_number
M.bought_freezes_left = bought_freezes_left
M.load_topaz = load_topaz
M.buy_freeze = buy_freeze

return M
