-- Login protection: after too many wrong passwords for one email address,
-- that address is paused for a while, even when the guesses come from many
-- different computers (nginx already limits each single computer).
--
-- The row is keyed by the email that was typed, whether or not an account
-- exists for it, so the pause can't be used to find out who has an account.
-- A successful sign-in removes the row. See handle_login in
-- lua/osiris/accounts.lua.
CREATE TABLE IF NOT EXISTS public.auth_login_failures (
    email text PRIMARY KEY,
    failures integer NOT NULL DEFAULT 0,
    first_failed_at timestamptz NOT NULL DEFAULT now(),
    locked_until timestamptz
);

CREATE INDEX IF NOT EXISTS auth_login_failures_first_failed_at_idx
    ON public.auth_login_failures (first_failed_at);

CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx
    ON public.auth_sessions (user_id);
