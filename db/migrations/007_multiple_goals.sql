-- Several goals per user.
--
-- Until now each user had exactly one progress tree (user_id was the primary
-- key). Now every goal is its own row with its own id, and one goal per user
-- is "active": the one shown in the side panel, which the interview, the AI
-- coach and "Complete step" work on. Existing trees become each user's
-- active goal, so nothing is lost.

ALTER TABLE public.user_progress_trees
    DROP CONSTRAINT user_progress_trees_pkey;

ALTER TABLE public.user_progress_trees
    ADD COLUMN id bigserial PRIMARY KEY;

ALTER TABLE public.user_progress_trees
    ADD COLUMN is_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.user_progress_trees
    ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

UPDATE public.user_progress_trees
SET created_at = updated_at;

-- At most one active goal per user.
CREATE UNIQUE INDEX user_progress_trees_one_active_idx
    ON public.user_progress_trees (user_id)
    WHERE is_active;

CREATE INDEX user_progress_trees_user_idx
    ON public.user_progress_trees (user_id);
