CREATE TABLE IF NOT EXISTS public.groq_daily_usage (
    usage_date date PRIMARY KEY,
    request_count integer NOT NULL CHECK (request_count > 0)
);
