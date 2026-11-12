CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.auth_users (
    id bigserial PRIMARY KEY,
    email text NOT NULL UNIQUE,
    password_hash text,
    google_sub text UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (email = lower(email)),
    CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.auth_sessions (
    token_hash text PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx
    ON public.auth_sessions (expires_at);
