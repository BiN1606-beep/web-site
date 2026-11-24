#!/usr/bin/env python3
"""Send Osiris's daily check-in reminders.

Runs every 15 minutes (see osiris-reminders.timer). For every push
subscription whose local time has reached its reminder hour, it sends one
reminder per day, but only if the user has a goal and hasn't checked in
today. "Today" is in each subscription's own time zone; PostgreSQL works it
out with AT TIME ZONE.

Why Python and not Lua like the rest of the server: a push message must be
encrypted for the receiving browser (RFC 8291) and signed with our VAPID key
(RFC 8292). OpenResty has no ready library for that, while pywebpush does
it in one call. Everything stays free: the browsers' push services don't
charge.

Settings (environment variables, loaded from /etc/mysite/deploy.env by the
systemd service):
  PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD   the database
  VAPID_PRIVATE_KEY_FILE   PEM file made by setup.sh
  VAPID_SUBJECT            contact for push services, default https://osiris-ai.se
"""

import json
import os
import re
import sys
from urllib.parse import urlparse

import psycopg
from pywebpush import WebPushException, webpush

# Only the real push services. The browser gives us the address, so without
# this check a user could make our server send requests anywhere.
PUSH_SERVICE_HOSTS = [
    re.compile(r"^fcm\.googleapis\.com$"),
    re.compile(r"^updates\.push\.services\.mozilla\.com$"),
    re.compile(r"^[a-z0-9-]+\.push\.apple\.com$"),
    re.compile(r"^[a-z0-9-]+\.notify\.windows\.com$"),
]

# Subscriptions due now: the local hour has reached remind_hour, nothing was
# sent today (local), the user has a goal and hasn't checked in today.
DUE_SUBSCRIPTIONS = """
    SELECT s.id, s.endpoint, s.p256dh, s.auth,
        (now() AT TIME ZONE s.timezone)::date AS local_day,
        (SELECT max(c.day) FROM public.daily_checkins c WHERE c.user_id = s.user_id) AS last_checkin
    FROM public.push_subscriptions s
    WHERE extract(hour FROM now() AT TIME ZONE s.timezone) >= s.remind_hour
      AND s.last_sent_day IS DISTINCT FROM (now() AT TIME ZONE s.timezone)::date
      AND EXISTS (
          SELECT 1 FROM public.user_progress_trees t
          WHERE t.user_id = s.user_id AND t.tree_data IS NOT NULL
      )
      AND NOT EXISTS (
          SELECT 1 FROM public.daily_checkins c
          WHERE c.user_id = s.user_id
            AND c.day = (now() AT TIME ZONE s.timezone)::date
      )
"""


def is_push_service(endpoint):
    parsed = urlparse(endpoint)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and any(pattern.match(host) for pattern in PUSH_SERVICE_HOSTS)


def reminder_text(local_day, last_checkin):
    """The message depends on where the streak stands."""
    if last_checkin is None:
        return "Your first check-in is waiting", "Take one minute: write what you did on your goal today."
    days_since = (local_day - last_checkin).days
    if days_since <= 1:
        return "Keep your streak alive", "You haven't checked in today. One line is enough."
    return "Your network misses you", "It's been a few days. One check-in today gets you back on track."


def main():
    private_key_file = os.environ.get("VAPID_PRIVATE_KEY_FILE", "/etc/mysite/vapid_private.pem")
    subject = os.environ.get("VAPID_SUBJECT", "https://osiris-ai.se")
    if not os.path.exists(private_key_file):
        print(f"No VAPID key at {private_key_file}; run reminders/setup.sh first.", file=sys.stderr)
        return 1

    sent = removed = failed = 0
    # psycopg reads PGHOST, PGDATABASE, PGUSER, PGPASSWORD and PGPORT itself.
    with psycopg.connect() as connection:
        rows = connection.execute(DUE_SUBSCRIPTIONS).fetchall()
        for subscription_id, endpoint, p256dh, auth, local_day, last_checkin in rows:
            if not is_push_service(endpoint):
                connection.execute("DELETE FROM public.push_subscriptions WHERE id = %s", (subscription_id,))
                removed += 1
                continue
            title, body = reminder_text(local_day, last_checkin)
            try:
                webpush(
                    subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
                    data=json.dumps({"title": title, "body": body}),
                    vapid_private_key=private_key_file,
                    vapid_claims={"sub": subject},
                    # Drop the message if the phone stays offline for 12 hours.
                    ttl=12 * 60 * 60,
                    timeout=10,
                )
            except WebPushException as error:
                status = error.response.status_code if error.response is not None else None
                if status in (404, 410):
                    # The browser unsubscribed or the app was removed.
                    connection.execute("DELETE FROM public.push_subscriptions WHERE id = %s", (subscription_id,))
                    removed += 1
                else:
                    print(f"Push to subscription {subscription_id} failed: {status or error}", file=sys.stderr)
                    failed += 1
                continue
            except Exception as error:  # network trouble: try again next run
                print(f"Push to subscription {subscription_id} failed: {error}", file=sys.stderr)
                failed += 1
                continue
            connection.execute(
                "UPDATE public.push_subscriptions SET last_sent_day = %s WHERE id = %s",
                (local_day, subscription_id),
            )
            # Save after each one, so a crash halfway never sends twice.
            connection.commit()
            sent += 1

    print(f"Reminders: {sent} sent, {removed} removed, {failed} failed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
