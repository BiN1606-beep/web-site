# web-site
the only website you'll ever need.

"vi ska ha med allt... ALLT" - BiN

## Accounts and sign-in

The site requires an account. Visitors can sign up with an email and password
or use Google sign-in once its OAuth credentials are configured. Email
passwords are stored as PostgreSQL `pgcrypto` bcrypt hashes. Session tokens
are random, stored hashed in PostgreSQL, and sent only in HttpOnly, SameSite
cookies.

### Security

- **Headers on every reply** (`lua/security_headers.lua`): HTTPS-only (HSTS),
  a Content-Security-Policy that only runs script files from this site, no
  framing by other sites, and more. Because of the CSP, pages must not
  contain inline `<script>` blocks or `onclick=` attributes: put JavaScript
  in a file under `public/js/` (the API tests check this). d3 is served from
  `public/js/d3.js` instead of a CDN for the same reason.
- **Cross-site requests**: every POST must come from an Osiris page (the
  browser's `Origin` header), on top of SameSite cookies and JSON-only
  bodies. See `same_origin_request` in `lua/osiris/common.lua`.
- **Password guessing**: nginx limits each computer, and after 10 wrong
  passwords for one email in 15 minutes that email is paused for 15 minutes
  (`auth_login_failures`). Unknown emails take as long to check as real
  ones, so sign-in doesn't reveal who has an account.
- **Google linking**: the first time Google is linked to an email that
  already had a password account, the old password and sessions are
  removed, because sign-up doesn't verify emails and someone else could
  have made that account first.
- **You stay in control**: Settings > Privacy and safety has "Sign out
  everywhere" and "Delete account" (deletes every row that belongs to you).
- **Admin-only tools**: anything for the site owner (debug menu, `/api/stats`)
  must check `is_progress_debug_user` on the server. Hiding a button is not
  enough.

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
and only the current step. Steps with several subtasks include a checklist;
all listed tasks must be checked before the step can be completed. Steps
without subtasks keep the simple completion flow. Each person can keep up to 8 goals, each with its own roadmap, progress,
conversation and AI memory (one row per goal in `user_progress_trees`). One
goal is the "focus": the side panel, the AI coach and "Complete step" work on
it. "+ Add a new goal" starts a new interview and keeps the earlier goals;
any goal can be made the focus or removed from the network. The AI places
every goal in a life area (Health, Learning, Mind, Career, Creativity,
Relationships, Money or Other), and the network groups goals around one hub
per area.

The progress tree is the whole home screen: an interactive network (like
Obsidian's graph view) fills the page, drawn with the free d3 library loaded
from cdnjs, and a side panel shows today's step or the dot you click. Skills
can be hidden and Recenter resets the view. The small button in its corner
customizes your network: its shape (a free web, a tree, a galaxy, orbits or lines), the colors, the
sky behind it (paper, dots or stars), how hard the lines pull, how spread
out it is, dot size, curvy lines and goal names. It also holds the
timelapse, which replays your network growing: play it, pick its speed
(slow to turbo), let all goal paths grow at the same time (on by default)
or in the real order, zoom in and follow the growth (on by default), and
turn on "Play on open" to watch it
each time you arrive (off by default). The choice is saved on your
account (`/api/network-style`), so it looks the same on every device.
Settings > Appearance picks a color theme for the whole site (Osiris paper,
the four Catppuccin flavors, Nord, Gruvbox, Rose Pine, Solarized, Tokyo
Night and Everforest, each with a light and a dark look), a font for
headings and a font for text (free Google Fonts, plus JetBrains Mono Nerd
Font served from `public/fonts`). It is saved on the account the same way
(`/api/appearance`, shared code in `lua/osiris/saved_look.lua`).
The goal sits in the middle, finished and current steps link out from it,
and the AI tags each step with 1-3 skills; steps that train the same skill
are connected through that skill's node, which grows as more steps use it.
Trees created before skills were added still work, just without skill nodes.
If d3 cannot load, the page falls back to a static drawing of the tree.

The dev tools panel opens with the `ä` key, or Settings > Dev tools, only for
the accounts matching an address in the server-side `DEBUG_MENU_EMAIL`
setting. Add one or more comma-separated sign-in emails to
`/etc/mysite/deploy.env`, for example
`DEBUG_MENU_EMAIL="first@example.com,second@example.com"`, then rerun the Deploy
workflow. Deployment writes the allowlist to a server-side file read by
OpenResty, so no OpenResty restart is needed just to apply the setting. For
everyone else the Settings button stays hidden and `ä` does nothing.

The panel (`public/js/devtools.js`, `/api/dev` in `lua/osiris/devtools.lua`)
shows everything about your own account in four tabs and lets you push it back
and forth while testing: jump to any step or finish a goal, restart the goal
interview, tap days on a 4-week calendar to add or remove check-ins, set the
streak to a number, skip a day (all your dates move one day back), grow or
unwater shared trees, clear follows and notifications, show the welcome flow
again, reset the look, and let today's reminder send again. Wiping buttons need
a second tap. Every action only touches your own rows and is checked by the
server, not just hidden in the page. A new feature can add its own card and
buttons on the server side (see `EXTRA_SECTIONS` in `devtools.lua`).

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

## Daily reminders

Users can turn on a daily reminder under Settings → Daily reminder. On days they haven't
checked in, their phone or computer gets a notification at the hour they
chose. It uses the browsers' free web push services; nothing is paid.

How it fits together:

- `public/sw.js` (service worker) shows the notification. `public/manifest.webmanifest`
  and `public/icons/` make Osiris installable as an app, which iPhones need
  before they allow notifications.
- The browser's push subscription is saved in `push_subscriptions`
  (migration 010) through the `reminder_subscribe` action of `/api/progress-tree`.
  Only addresses at the real push services (Google, Mozilla, Apple,
  Microsoft) are accepted.
- `lua/osiris/push_sender.lua` runs inside OpenResty every 5 minutes and
  sends the reminders that are due, and friends' nudges. Push messages must
  be encrypted for each browser (RFC 8291) and signed with our key (RFC
  8292); it does both with `lua-resty-openssl`, which comes with OpenResty.
  So the server needs nothing extra: no Python, no separate timer.

### Server setup

There is no manual step. The first deploy makes the key pair that signs
push messages (`reminders/make_vapid_keys.sh`, using the `openssl` command):
`/etc/mysite/vapid_private.pem` (readable by root only; OpenResty's master
process reads it at start) and `/etc/mysite/vapid_public.txt`, which deploy
copies to where the site reads it. From then on deploy always keeps that
pair. Never delete or replace it: every reminder people have turned on would
stop working.

The sender logs to OpenResty's error log; look for lines with
"Push messages" or "push sender".

## Tests

Every pull request runs all tests on GitHub (`.github/workflows/test.yml`);
a red cross means something broke. To run them yourself you need Docker
(on Windows, run it from Git Bash):

```sh
bash tests/run_all.sh
```

It checks that all JavaScript compiles and the streak math is right, runs
every migration on a fresh PostgreSQL, starts the real Lua server code in
OpenResty and calls the API like a browser (`tests/api/api_test.sh`), and
sends reminders to a fake push service. It takes about a minute.
`tests/smoke.sh` is a separate quick check against a running site.

To click around the site on your own computer, `bash tests/dev_server.sh`
starts it at http://localhost:8080 with an empty database (sign up with
any test email). Stop it with `bash tests/dev_server.sh stop`. The AI
coach, Google sign-in and reminders aren't connected there.
