-- Daily reminders through web push notifications.
--
-- When someone turns reminders on, their browser gives us a "push
-- subscription": an address at the browser maker's push service (Google,
-- Mozilla, Apple or Microsoft) plus two keys that encrypt the message so
-- only that browser can read it. Each device has its own subscription.
--
-- reminders/send_reminders.py runs every 15 minutes. It sends a reminder to
-- each subscription whose local time has reached remind_hour, unless the
-- user already checked in today or was already reminded today
-- (last_sent_day, in the user's local time zone).

CREATE TABLE public.push_subscriptions (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
    endpoint text NOT NULL UNIQUE CHECK (length(endpoint) BETWEEN 1 AND 1000),
    p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 1 AND 200),
    auth text NOT NULL CHECK (length(auth) BETWEEN 1 AND 100),
    -- An IANA time zone name such as "Europe/Stockholm", checked against
    -- pg_timezone_names when saved.
    timezone text NOT NULL,
    remind_hour smallint NOT NULL DEFAULT 20 CHECK (remind_hour BETWEEN 0 AND 23),
    last_sent_day date,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions (user_id);
