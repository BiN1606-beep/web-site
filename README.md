# web-site
the only website you'll ever need.

"vi ska ha med allt... ALLT" - BiN

## Accounts and sign-in

The site requires an account. Visitors can sign up with an email and password
or use Google sign-in once its OAuth credentials are configured. Email
passwords are stored as PostgreSQL `pgcrypto` bcrypt hashes. Session tokens
are random, stored hashed in PostgreSQL, and sent only in HttpOnly, SameSite
cookies.

Database migrations run automatically during deployment. The deploy process
uses the PostgreSQL settings available in its environment (`PGHOST`,
`PGDATABASE`, `PGUSER`, and `PGPASSWORD`) and requires `psql` on the server.
Each migration is applied in a transaction and recorded in
`public.schema_migrations`; a changed migration that was already applied stops
the deployment. Give the deploy role the PostgreSQL permissions needed to
create the migration-history table and apply schema changes.

If the SSH deployment does not inherit the database settings, `deploy.sh` loads
them from `/etc/mysite/deploy.env` on the server. Create this file as the root
user, make it readable only by the deployment user (for example, mode `640`
with that user's primary group), and add shell assignments for `PGHOST`,
`PGDATABASE`, `PGUSER`, and `PGPASSWORD`. Do not commit this file or share its
contents. When connected as the same account used by `DEPLOY_USER`, create and
secure the file with:

```sh
sudo install -d -o root -g "$(id -gn)" -m 750 /etc/mysite
sudoedit /etc/mysite/deploy.env
sudo chown root:"$(id -gn)" /etc/mysite/deploy.env
sudo chmod 640 /etc/mysite/deploy.env
```

In the editor, add shell assignments for the four variables, using the
database connection values already used by the site. The deployment workflow
loads this file before starting `deploy.sh`. After creating the file, rerun
the failed Deploy workflow.

Add migrations as `NNN_description.sql` files in `db/migrations/`, ordered by
their three-digit prefix. Do not put `BEGIN` or `COMMIT` in migration files;
the runner applies each file and its history record atomically.

Profile details, first-login onboarding, display names, progress trees, and
Community schema migrations are applied automatically during deployment.

New profiles can be edited from the Profile panel or Settings. The onboarding
choice is saved to the user's account, and skipped profiles can be completed
later. Display names, profile pictures, gender, bio, and goals are stored with
the profile in PostgreSQL. Profile pictures are resized to a small JPEG in the
browser before saving.

The personalized Progress Tree stores each user's roadmap, completed steps,
conversation history, and AI coaching memory in PostgreSQL. Creating or
adjusting a path uses the existing Groq integration and its shared daily usage
limit; it remains unavailable unless the configured quota is confirmed to be
free. New trees start with a 10-answer, multiple-choice AI interview; the full
personalized roadmap is stored, while the interface reveals completed steps
and only the current step. Existing trees can be replaced by starting a new
tree; the interface asks for confirmation because this resets the current
tree's progress.

Community supports discovery, friend requests, following, activity reactions,
notifications, blocks, and reports. Profiles and progress trees are private by
default; users can opt in to sharing them from Community > Privacy. The server
filters profile and journey data according to those settings. Accounts receive
a searchable username in the form `user<ID>`. Community search also supports
exact email matches for users who are discoverable; email addresses are never
included in search results.

Google OAuth requires the site to be served over HTTPS. The current HTTP IP
address (`http://34.71.166.63`) cannot be used as a Google OAuth redirect URI.
Set up a domain and TLS first, then create a **Web application** OAuth client
in Google Cloud Console and add this exact authorized redirect URI:

```text
https://your-domain/api/auth/google/callback
```

Set these server-side OpenResty environment variables to match that client:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`, set to `https://your-domain/api/auth/google/callback`

Keep the client secret on the server; do not put it in the page or commit it.
Register the exact redirect URI in the Google OAuth client and browse the site
using its HTTPS domain when signing in. The `pgmoon` Lua module must be
available to OpenResty as it is for the existing PostgreSQL endpoints.
Email/password signup does not verify ownership of the email address. The
authentication routes use OpenResty's built-in Lua subrequests to exchange and
verify Google user information over TLS.

## Groq AI demo

The Groq chat endpoint is disabled unless `GROQ_FREE_QUOTA_CONFIRMED=1` and
`GROQ_FREE_DAILY_REQUEST_LIMIT` are set in OpenResty's environment. Only enable
it after confirming in the Groq account that the configured daily limit is
guaranteed to incur no charges. The [public rate-limit documentation](https://console.groq.com/docs/rate-limits)
does not establish that an account's usage is free.

The API key stays server-side in `GROQ_API_KEY`. The endpoint accepts prompts
up to 2000 bytes and is rate-limited per client IP. Its daily request cap is
shared across visitors and OpenResty instances using the same PostgreSQL
database, and resets at UTC midnight. Its database table is created
automatically by the migration runner during deployment.

Set the limit no higher than the account's verified free quota. If the quota
cannot be confirmed, leave `GROQ_FREE_QUOTA_CONFIRMED` unset; the endpoint
remains disabled.
