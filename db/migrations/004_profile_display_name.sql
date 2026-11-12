ALTER TABLE public.auth_users
    ADD COLUMN IF NOT EXISTS profile_display_name text NOT NULL DEFAULT '';
