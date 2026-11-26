-- Topaz orbs: the one and only reward.
--
-- Finishing a daily task no longer pays a fixed 10 topaz. It gives you an
-- orb instead, and opening the orb gives 20 to 100 topaz, in steps of 5.
-- The daily tasks are the same as before:
--  * your own daily check-in (finishing a step counts too), once a day,
--  * a check-in on a shared goal, once per goal and day, on up to 3
--    shared goals a day.
--
-- How it can't be cheated:
--  * The amount is drawn by the database the moment the orb is made and
--    saved in the row. The browser never sees it before the orb is open,
--    and opening only reveals it, so there is nothing to reroll.
--  * The UNIQUE key makes a second orb for the same task and day
--    impossible, even if two requests race. Undoing a step and finishing
--    it again on the same day therefore gives nothing extra.
--  * Opening pays through topaz_earnings with the orb's id as ref_id, so
--    the same orb can never pay twice.
--
-- Freezes get pricier in lua/osiris/topaz.lua (400 instead of 70), since
-- an orb is worth 60 on average instead of 10. To be fair to the topaz
-- people already saved, every wallet is multiplied by 6 once, below.

CREATE TABLE public.topaz_orbs (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    day date NOT NULL,
    -- 'dev' orbs come from the owner-only dev tools (lua/osiris/topaz_dev.lua).
    reason text NOT NULL CHECK (reason IN ('checkin', 'shared_checkin', 'dev')),
    -- The shared tree for 'shared_checkin', a counter for 'dev', else 0.
    ref_id bigint NOT NULL DEFAULT 0,
    amount integer NOT NULL CHECK (amount BETWEEN 20 AND 100 AND amount % 5 = 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    opened_at timestamptz,
    UNIQUE (user_id, day, reason, ref_id)
);
CREATE INDEX topaz_orbs_waiting_idx ON public.topaz_orbs (user_id) WHERE opened_at IS NULL;

-- What's inside an orb: 20, 25, ... 100, each just as likely (60 on
-- average).
CREATE FUNCTION public.topaz_orb_amount()
RETURNS integer
LANGUAGE sql
VOLATILE
AS $$
    SELECT 20 + 5 * floor(random() * 17)::integer
$$;

-- Opening an orb pays through the earnings table, so the wallet trigger
-- from 015_topaz_gems.sql still does the adding.
ALTER TABLE public.topaz_earnings DROP CONSTRAINT topaz_earnings_reason_check;
ALTER TABLE public.topaz_earnings ADD CONSTRAINT topaz_earnings_reason_check
    CHECK (reason IN ('checkin', 'shared_checkin', 'orb'));

-- Your own daily check-in: one orb a day. Editing today's line is an
-- UPDATE, so it doesn't give another.
CREATE OR REPLACE FUNCTION public.topaz_for_checkin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO public.topaz_orbs (user_id, day, reason, ref_id, amount)
    VALUES (NEW.user_id, NEW.day, 'checkin', 0, public.topaz_orb_amount())
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$;

-- A check-in on a shared goal: one orb per goal and day, on at most 3
-- shared goals a day.
CREATE OR REPLACE FUNCTION public.topaz_for_shared_checkin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF (SELECT count(*) FROM public.topaz_orbs
        WHERE user_id = NEW.user_id AND day = NEW.day AND reason = 'shared_checkin') < 3 THEN
        INSERT INTO public.topaz_orbs (user_id, day, reason, ref_id, amount)
        VALUES (NEW.user_id, NEW.day, 'shared_checkin', NEW.tree_id, public.topaz_orb_amount())
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

-- The same triggers (daily_checkins_earn_topaz and
-- shared_tree_waterings_earn_topaz) now call the new function bodies.

-- Old savings keep their worth at the new prices.
UPDATE public.topaz_wallets SET balance = balance * 6;
