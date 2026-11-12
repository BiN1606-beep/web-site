CREATE TABLE public.user_progress_trees (
    user_id bigint PRIMARY KEY REFERENCES public.auth_users(id) ON DELETE CASCADE,
    tree_data jsonb,
    completed_count integer NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
    conversation jsonb NOT NULL DEFAULT '[]'::jsonb,
    ai_memory text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        tree_data IS NULL
        OR completed_count <= jsonb_array_length(tree_data->'steps')
    )
);
