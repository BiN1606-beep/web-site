-- Daily check-ins: the basis for streaks.
--
-- A streak grows by one for every day you "show up". Showing up means a
-- check-in: one short line about what you did on your current step today.
-- Finishing a step counts too (the server adds a check-in for that day).
-- Steps can take a week, so asking for a finished step every day would be
-- too strict; a daily line keeps you coming back without that.
--
-- "day" is the date in the user's own time zone, sent by the browser. A
-- server in UTC can't know when midnight is for the user, and a streak that
-- breaks at 01:00 local time would feel wrong. The server only accepts a
-- date within one day of its own date (time zones span about +-14 hours),
-- so nobody can check in for a week ago or next month.
--
-- One check-in per user per day: the streak counts days, not check-ins.

CREATE TABLE public.daily_checkins (
    user_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    day date NOT NULL,
    -- The goal that was in focus. If that goal is removed later, the day
    -- still counts for the streak.
    goal_id bigint REFERENCES public.user_progress_trees(id) ON DELETE SET NULL,
    note text NOT NULL CHECK (length(note) BETWEEN 1 AND 280),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, day)
);
