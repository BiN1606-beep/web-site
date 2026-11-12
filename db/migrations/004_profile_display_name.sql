BEGIN;

ALTER TABLE public.auth_users
    ADD COLUMN profile_display_name text NOT NULL DEFAULT '';

COMMIT;
