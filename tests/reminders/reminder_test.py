"""End-to-end test of the server's push sender (lua/osiris/push_sender.lua).

The server runs in its own container (tests/run_all.sh, step 3). This test
runs a fake push service, puts subscriptions in the database, and asks the
server to send (/_test/send-reminders, which only exists in the test
nginx.conf). The fake service records each request and answers 201 (or 410
for a "gone" subscription). The test then checks the VAPID signature and
decrypts each message with the receiving browser's private key, using
independent libraries, which proves the Lua crypto is right.

Python is only used here, in the test container; the real server has none.
"""
import base64
import json
import os
import threading
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

import http_ece
import psycopg
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

WEB_URL = os.environ["WEB_URL"]
PUSH_BASE = f"http://{os.environ['PUSH_HOST']}:8099"

received = []


class FakePushService(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        received.append((self.path, {k.lower(): v for k, v in self.headers.items()}, body))
        self.send_response(410 if self.path.endswith("/gone") else 201)
        self.end_headers()

    def log_message(self, *args):
        pass


server = HTTPServer(("0.0.0.0", 8099), FakePushService)
threading.Thread(target=server.serve_forever, daemon=True).start()


def run_sender():
    query = urllib.parse.urlencode({"allow": PUSH_BASE + "/"})
    with urllib.request.urlopen(f"{WEB_URL}/_test/send-reminders?{query}", timeout=30) as response:
        counts = json.loads(response.read())
    assert "error" not in counts, counts
    return counts


def unb64(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def check_vapid(headers):
    """The Authorization header is a valid ES256 token for our push service."""
    auth = headers["authorization"]
    assert auth.startswith("vapid t="), auth
    token, key = auth[len("vapid t="):].split(", k=")
    header, claims, signature = token.split(".")
    assert json.loads(unb64(header)) == {"typ": "JWT", "alg": "ES256"}, header
    claims = json.loads(unb64(claims))
    assert claims["aud"] == PUSH_BASE, claims
    assert claims["sub"] == "https://osiris-ai.se", claims
    public = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), unb64(key))
    raw = unb64(signature)
    assert len(raw) == 64, len(raw)
    der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
    signed = token.rsplit(".", 1)[0]
    public.verify(der, signed.encode(), ec.ECDSA(hashes.SHA256()))


def decrypt(body):
    return json.loads(http_ece.decrypt(body, private_key=browser_key, auth_secret=auth_secret, version="aes128gcm"))


# A fake browser: its key pair and auth secret.
browser_key = ec.generate_private_key(ec.SECP256R1())
browser_public = browser_key.public_key().public_bytes(
    serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
auth_secret = os.urandom(16)

with psycopg.connect(autocommit=True) as db:
    db.execute("DELETE FROM push_subscriptions; DELETE FROM daily_checkins")
    # Two users of our own: one with a goal, one without.
    with_goal, without_goal = (
        db.execute(
            "INSERT INTO auth_users (email, password_hash) VALUES (%s, 'x') RETURNING id", (email,)
        ).fetchone()[0]
        for email in ("reminder-goal@test", "reminder-nogoal@test")
    )
    db.execute(
        "INSERT INTO user_progress_trees (user_id, tree_data, completed_count, is_active) "
        "VALUES (%s, '{\"goal\":\"G\",\"steps\":[]}', 0, true)", (with_goal,))
    for user_id, path in ((with_goal, "/ok"), (with_goal, "/gone"), (without_goal, "/nogoal")):
        db.execute(
            "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, timezone, remind_hour) "
            "VALUES (%s, %s, %s, %s, 'UTC', 0)",
            (user_id, PUSH_BASE + path, b64(browser_public), b64(auth_secret)))
    # An address that is not a real push service (and not the test's) is
    # never called, and the subscription is removed.
    db.execute(
        "INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, timezone, remind_hour) "
        "VALUES (%s, 'http://evil.example.com/x', %s, %s, 'UTC', 0)",
        (with_goal, b64(browser_public), b64(auth_secret)))

    counts = run_sender()
    paths = sorted(path for path, _, _ in received)
    assert paths == ["/gone", "/ok"], (paths, counts)  # user 2 has no goal: no reminder
    assert counts == {"sent": 1, "removed": 2, "failed": 0}, counts
    path, headers, body = next(item for item in received if item[0] == "/ok")
    assert headers["content-encoding"] == "aes128gcm", headers
    assert headers["ttl"] == "43200", headers
    check_vapid(headers)
    message = decrypt(body)
    assert message["title"] == "Your first check-in is waiting", message
    remaining = [row[0] for row in db.execute("SELECT endpoint FROM push_subscriptions ORDER BY id")]
    assert remaining == [PUSH_BASE + "/ok", PUSH_BASE + "/nogoal"], remaining  # 410 and evil removed

    # Second run the same day: nothing more is sent.
    received.clear()
    run_sender()
    assert received == [], received

    # Next "day" with yesterday's check-in: the streak message.
    db.execute("UPDATE push_subscriptions SET last_sent_day = NULL")
    db.execute("INSERT INTO daily_checkins (user_id, day, note) VALUES (%s, (now() AT TIME ZONE 'UTC')::date - 1, 'x')", (with_goal,))
    run_sender()
    assert decrypt(received[-1][2])["title"] == "Keep your streak alive"

    # A few days away: the "misses you" message.
    received.clear()
    db.execute("UPDATE push_subscriptions SET last_sent_day = NULL")
    db.execute("UPDATE daily_checkins SET day = day - 3")
    run_sender()
    assert decrypt(received[-1][2])["title"] == "Your network misses you"
    db.execute("UPDATE daily_checkins SET day = day + 3")

    # Checked in today: no reminder.
    received.clear()
    db.execute("UPDATE push_subscriptions SET last_sent_day = NULL")
    db.execute("INSERT INTO daily_checkins (user_id, day, note) VALUES (%s, (now() AT TIME ZONE 'UTC')::date, 'x')", (with_goal,))
    run_sender()
    assert received == [], received

    # Reminder hour not reached yet in the user's zone: no reminder.
    db.execute("DELETE FROM daily_checkins WHERE day = (now() AT TIME ZONE 'UTC')::date")
    db.execute("""UPDATE push_subscriptions SET last_sent_day = NULL,
                  remind_hour = LEAST(23, extract(hour FROM now() AT TIME ZONE 'UTC')::int + 1)""")
    hour_now = db.execute("SELECT extract(hour FROM now() AT TIME ZONE 'UTC')::int").fetchone()[0]
    run_sender()
    if hour_now < 23:
        assert received == [], received

    # A failed send (push service down) is tried again next run.
    db.execute("UPDATE push_subscriptions SET last_sent_day = NULL, remind_hour = 0")
    server.shutdown()
    server.server_close()
    counts = run_sender()
    assert counts["failed"] == 1 and counts["sent"] == 0, counts
    assert db.execute("SELECT last_sent_day FROM push_subscriptions WHERE endpoint = %s",
                      (PUSH_BASE + "/ok",)).fetchone()[0] is None
    server = HTTPServer(("0.0.0.0", 8099), FakePushService)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    received.clear()
    run_sender()
    assert [path for path, _, _ in received] == ["/ok"], received

    # A friend's nudge goes to every device of that friend, once.
    friend = db.execute("INSERT INTO auth_users (email, password_hash, profile_display_name) "
                        "VALUES ('nudger@test', 'x', 'Maja') RETURNING id").fetchone()[0]
    low, high = sorted((friend, with_goal))
    tree_id = db.execute("INSERT INTO shared_trees (user_low, user_high, planted_by, title, status) "
                         "VALUES (%s, %s, %s, 'Run every morning', 'growing') RETURNING id",
                         (low, high, friend)).fetchone()[0]
    db.execute("INSERT INTO shared_tree_nudges (tree_id, from_user, to_user, day) "
               "VALUES (%s, %s, %s, (now() AT TIME ZONE 'UTC')::date)", (tree_id, friend, with_goal))
    db.execute("UPDATE push_subscriptions SET last_sent_day = (now() AT TIME ZONE 'UTC')::date")
    received.clear()
    run_sender()
    assert [path for path, _, _ in received] == ["/ok"], received
    message = decrypt(received[0][2])
    assert message["title"] == "Maja is waiting for you" and "“Run every morning”" in message["body"], message
    assert message["tag"] == f"osiris-nudge-{tree_id}", message
    received.clear()
    run_sender()
    assert received == [], received  # sent once

print("REMINDER_TESTS_OK")
