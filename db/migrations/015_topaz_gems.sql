-- Topaz: a small in-app currency (yellow gems). You earn it by showing up
-- and spend it on streak freezes. It can't be bought with real money.
--
-- How you earn (once per task per day, so it can't be farmed):
--  * 10 topaz for your daily check-in (finishing a step counts too),
--  * 10 topaz for checking in on a shared goal, on up to 3 shared goals a
--    day (so following lots of people doesn't turn into a gem farm).
-- One streak freeze costs 70 topaz: a week of showing up.
--
-- The gems are handed out by triggers on the check-in tables. That way
-- every way of checking in (the check-in box, finishing a step, a shared
-- goal) pays out in the same database transaction, and the primary key of
-- topaz_earnings makes a second payout for the same task and day
-- impossible, even if two requests race. Undoing a step and finishing it
-- again on the same day therefore earns nothing extra.

-- One row per thing that paid out. reason says what it was; ref_id is the
-- shared tree for 'shared_checkin' and 0 for your own check-in.
CREATE TABLE public.topaz_earnings (
    user_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    day date NOT NULL,
    reason text NOT NULL CHECK (reason IN ('checkin', 'shared_checkin')),
    ref_id bigint NOT NULL DEFAULT 0,
    amount integer NOT NULL CHECK (amount > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, day, reason, ref_id)
);

-- What you have right now. The CHECK makes it impossible to spend gems you
-- don't have: a purchase is an UPDATE ... WHERE balance >= price, which
-- PostgreSQL runs one at a time per row.
CREATE TABLE public.topaz_wallets (
    user_id bigint PRIMARY KEY REFERENCES public.auth_users(id) ON DELETE CASCADE,
    balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0)
);

-- Streak freezes bought with topaz. "day" is the buyer's local date: the
-- freeze can cover a missed day from then on (never one that is already
-- missed). Which day it ends up covering is worked out from the check-in
-- days, like the freezes you earn with a 7-day streak (public/js/streak.js).
CREATE TABLE public.freeze_purchases (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    day date NOT NULL,
    price integer NOT NULL CHECK (price > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX freeze_purchases_user_idx ON public.freeze_purchases (user_id, day);

-- Every payout also adds to the wallet.
CREATE FUNCTION public.topaz_add_to_wallet()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO public.topaz_wallets (user_id, balance)
    VALUES (NEW.user_id, NEW.amount)
    ON CONFLICT (user_id) DO UPDATE SET balance = topaz_wallets.balance + EXCLUDED.balance;
    RETURN NEW;
END;
$$;

CREATE TRIGGER topaz_earnings_fill_wallet
AFTER INSERT ON public.topaz_earnings
FOR EACH ROW
EXECUTE FUNCTION public.topaz_add_to_wallet();

-- Your own daily check-in: 10 topaz, once per day. Editing today's line is
-- an UPDATE, so it doesn't pay again.
CREATE FUNCTION public.topaz_for_checkin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO public.topaz_earnings (user_id, day, reason, ref_id, amount)
    VALUES (NEW.user_id, NEW.day, 'checkin', 0, 10)
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER daily_checkins_earn_topaz
AFTER INSERT ON public.daily_checkins
FOR EACH ROW
EXECUTE FUNCTION public.topaz_for_checkin();

-- A check-in on a shared goal: 10 topaz per goal and day, on at most 3
-- shared goals a day.
CREATE FUNCTION public.topaz_for_shared_checkin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF (SELECT count(*) FROM public.topaz_earnings
        WHERE user_id = NEW.user_id AND day = NEW.day AND reason = 'shared_checkin') < 3 THEN
        INSERT INTO public.topaz_earnings (user_id, day, reason, ref_id, amount)
        VALUES (NEW.user_id, NEW.day, 'shared_checkin', NEW.tree_id, 10)
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER shared_tree_waterings_earn_topaz
AFTER INSERT ON public.shared_tree_waterings
FOR EACH ROW
EXECUTE FUNCTION public.topaz_for_shared_checkin();
