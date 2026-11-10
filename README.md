# web-site
the only website you'll ever need.

"vi ska ha med allt... ALLT" - BiN

## Groq AI demo

The Groq chat endpoint is disabled unless `GROQ_FREE_QUOTA_CONFIRMED=1` and
`GROQ_FREE_DAILY_REQUEST_LIMIT` are set in OpenResty's environment. Only enable
it after confirming in the Groq account that the configured daily limit is
guaranteed to incur no charges. The [public rate-limit documentation](https://console.groq.com/docs/rate-limits)
does not establish that an account's usage is free.

The API key stays server-side in `GROQ_API_KEY`. The endpoint accepts prompts
up to 2000 bytes and is rate-limited per client IP. Its daily request cap is
shared across visitors and OpenResty instances using the same PostgreSQL
database, and resets at UTC midnight. Apply
[`db/migrations/001_groq_daily_usage.sql`](db/migrations/001_groq_daily_usage.sql)
once using the PostgreSQL role configured for OpenResty:

```sh
psql -v ON_ERROR_STOP=1 -f db/migrations/001_groq_daily_usage.sql
```

Set the limit no higher than the account's verified free quota. If the quota
cannot be confirmed, leave `GROQ_FREE_QUOTA_CONFIRMED` unset; the endpoint
remains disabled.
