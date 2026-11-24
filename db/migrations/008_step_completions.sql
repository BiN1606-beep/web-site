-- When each step was completed.
--
-- Until now a goal only stored completed_count: how many steps are done, but
-- not when. Streaks, a real timelapse, the "recent" glow and weekly reviews
-- all need the date, so every completed step now gets a row here.
--
-- step_index is 0-based, matching the position in tree_data->'steps'.
-- user_id is stored as well (it could be found through goal_id) so that
-- questions like "on which days was this user active?" need no join.
--
-- Steps completed before this migration have no row: their real dates were
-- never saved, and making them up would give wrong streaks. The site treats
-- them as "done, date unknown".

CREATE TABLE public.step_completions (
    goal_id bigint NOT NULL REFERENCES public.user_progress_trees(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    step_index integer NOT NULL CHECK (step_index >= 0),
    completed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (goal_id, step_index)
);

CREATE INDEX step_completions_user_time_idx
    ON public.step_completions (user_id, completed_at DESC);
