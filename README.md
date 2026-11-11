# web-site
the only website you'll ever need.

"vi ska ha med allt... ALLT" - BiN

## Accounts and sign-in

The site requires an account. Visitors can sign up with an email and password
or use Google sign-in. Email passwords are stored as PostgreSQL `pgcrypto`
bcrypt hashes. Session tokens are random, stored hashed in PostgreSQL, and
sent only in HttpOnly, SameSite cookies.

Apply the authentication migration using the PostgreSQL role configured for
OpenResty:

```sh
psql -v ON_ERROR_STOP=1 -f db/migrations/002_auth.sql
```

Set these server-side OpenResty environment variables for Google OAuth:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`, set to `https://your-domain/api/auth/google/callback`

Register that exact redirect URI in the Google OAuth client. The `pgmoon` Lua
module must be available to OpenResty as it is for the existing PostgreSQL
endpoints. Email/password signup does not verify ownership of the email
address. The authentication routes also use OpenResty's built-in Lua
subrequests to exchange and verify Google user information over TLS.

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
