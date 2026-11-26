-- Routines: small things you want to do again and again (drink water,
-- stretch, read 10 pages), each with its own rhythm.
--
-- A routine repeats in one of three ways (repeat_kind):
--   daily     every day
--   weekdays  on chosen weekdays; "weekdays" is a bit mask with Monday = 1,
--             Tuesday = 2, Wednesday = 4 ... Sunday = 64 (so 31 = Mon-Fri)
--   every     every N days (every_days), counted from start_day, so
--             "every 2 days" is every other day and "every 7 days" weekly
--
-- Each routine can also have a start and stop time and a place in your
-- list (see the columns below).
--
-- start_day is the user's local date when the routine was made, and
-- removed_on the date it was removed. Removing only sets removed_on, so the
-- month grid in "Your stats" still shows the days you did it before.
--
-- lua/osiris/routines.lua checks every value before it is saved; the
-- CHECKs below are a second safety net.

CREATE TABLE public.routines (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
    repeat_kind text NOT NULL CHECK (repeat_kind IN ('daily', 'weekdays', 'every')),
    weekdays smallint NOT NULL DEFAULT 127 CHECK (weekdays BETWEEN 1 AND 127),
    every_days smallint NOT NULL DEFAULT 1 CHECK (every_days BETWEEN 1 AND 30),
    start_day date NOT NULL,
    removed_on date,
    -- Where it sits in your list: you can drag routines into any order.
    position integer NOT NULL DEFAULT 0,
    -- An optional time of day to start and to stop, as "HH:MM" (your own
    -- local time). A stop time needs a start time; a stop earlier than the
    -- start means it runs past midnight (22:30 to 06:30).
    start_time text CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    end_time text CHECK (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    CHECK (end_time IS NULL OR (start_time IS NOT NULL AND end_time <> start_time)),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX routines_user_idx ON public.routines (user_id);

-- One row for each day a routine was done. user_id is stored too, so
-- "only your own" can be checked in one place and loading a month is a
-- single index lookup.
CREATE TABLE public.routine_checks (
    routine_id bigint NOT NULL REFERENCES public.routines(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    day date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (routine_id, day)
);

CREATE INDEX routine_checks_user_day_idx ON public.routine_checks (user_id, day);
