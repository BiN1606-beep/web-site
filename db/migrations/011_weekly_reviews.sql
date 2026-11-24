-- Weekly reviews by the AI coach.
--
-- Once a week the user can ask the coach to look back at the last 7 days:
-- the check-in notes, the steps finished, and how long the current step
-- has taken. The coach writes a short review. It is saved so it stays
-- visible all week and so each week costs only one AI request (the free
-- Groq quota is shared by everyone).
--
-- week_start is the Monday of the user's week, in their own time zone
-- (sent by the browser, like check-in days). One review per user per week.

CREATE TABLE public.weekly_reviews (
    user_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    week_start date NOT NULL CHECK (extract(isodow FROM week_start) = 1),
    -- The goal that was in focus. Removing it later keeps the review.
    goal_id bigint REFERENCES public.user_progress_trees(id) ON DELETE SET NULL,
    -- { headline, went_well, watch_out, next_week, suggest_adjust,
    --   days_checked_in, steps_finished }
    review jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, week_start)
);
