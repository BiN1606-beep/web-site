"""End-to-end test of reminders/send_reminders.py against a fake push service.

The fake service records each request and answers 201 (or 410 for a
"gone" subscription). The test then decrypts the message with the
receiving browser's private key, which proves the encryption is right.
"""
import base64
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import http_ece
import psycopg
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

REMINDERS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "reminders")
sys.path.insert(0, REMINDERS)
import send_reminders  # noqa: E402

received = []


class FakePushService(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        received.append((self.path, {k.lower(): v for k, v in self.headers.items()}, body))
        self.send_response(410 if self.path.endswith("/gone") else 201)
        self.end_headers()

    def log_message(self, *args):
        pass


server = HTTPServer(("127.0.0.1", 8099), FakePushService)
threading.Thread(target=server.serve_forever, daemon=True).start()

# Make the VAPID key the same way setup.sh does.
setup = open(os.path.join(REMINDERS, "setup.sh")).read()
key_script = setup.split("<<'PY'\n", 1)[1].split("\nPY\n", 1)[0]
for path in ("/tmp/vapid_private.pem", "/tmp/vapid_public.txt"):
    if os.path.exists(path):
        os.remove(path)
subprocess.run([sys.executable, "-I", "-", "/tmp/vapid_private.pem", "/tmp/vapid_public.txt"],
               input=key_script.encode(), check=True)
public_key = open("/tmp/vapid_public.txt").read().strip()
assert len(public_key) == 87, public_key
assert oct(os.stat("/tmp/vapid_private.pem").st_mode & 0o777) == "0o600"
os.environ["VAPID_PRIVATE_KEY_FILE"] = "/tmp/vapid_private.pem"

# A fake browser: its key pair and auth secret.
browser_key = ec.generate_private_key(ec.SECP256R1())
browser_public = browser_key.public_key().public_bytes(
    serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
b64 = lambda raw: base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
auth_secret = os.urandom(16)

# The real check refuses anything but real push services; the fake runs on
# localhost over http, so allow it here (and test the check separately).
assert send_reminders.is_push_service("https://fcm.googleapis.com/fcm/send/abc")
assert send_reminders.is_push_service("https://web.push.apple.com/QGx")
assert not send_reminders.is_push_service("https://evil.example.com/fcm.googleapis.com/")
assert not send_reminders.is_push_service("http://fcm.googleapis.com/x")
send_reminders.is_push_service = lambda endpoint: endpoint.startswith("http://127.0.0.1:8099/")

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
            (user_id, "http://127.0.0.1:8099" + path, b64(browser_public), b64(auth_secret)))
    # A subscription whose reminder hour hasn't come yet (23:00 in a zone
    # where it's earlier) is checked by the hour rule below.

    assert send_reminders.main() == 0
    paths = sorted(path for path, _, _ in received)
    assert paths == ["/gone", "/ok"], paths  # user 2 has no goal: no reminder
    path, headers, body = next(item for item in received if item[0] == "/ok")
    assert headers["content-encoding"] == "aes128gcm"
    assert headers["authorization"].startswith("vapid t=") and f"k={public_key}" in headers["authorization"]
    message = json.loads(http_ece.decrypt(body, private_key=browser_key, auth_secret=auth_secret, version="aes128gcm"))
    assert message["title"] == "Your first check-in is waiting", message
    remaining = [row[0] for row in db.execute("SELECT endpoint FROM push_subscriptions ORDER BY id")]
    assert remaining == ["http://127.0.0.1:8099/ok", "http://127.0.0.1:8099/nogoal"], remaining  # 410 removed

    # Second run the same day: nothing more is sent.
    received.clear()
    assert send_reminders.main() == 0
    assert received == [], received

    # Next "day" with yesterday's check-in: the streak message.
    db.execute("UPDATE push_subscriptions SET last_sent_day = NULL")
    db.execute("INSERT INTO daily_checkins (user_id, day, note) VALUES (%s, (now() AT TIME ZONE 'UTC')::date - 1, 'x')", (with_goal,))
    send_reminders.main()
    _, _, body = received[-1]
    message = json.loads(http_ece.decrypt(body, private_key=browser_key, auth_secret=auth_secret, version="aes128gcm"))
    assert message["title"] == "Keep your streak alive", message

    # Checked in today: no reminder.
    received.clear()
    db.execute("UPDATE push_subscriptions SET last_sent_day = NULL")
    db.execute("INSERT INTO daily_checkins (user_id, day, note) VALUES (%s, (now() AT TIME ZONE 'UTC')::date, 'x')", (with_goal,))
    send_reminders.main()
    assert received == [], received

    # Reminder hour not reached yet in the user's zone: no reminder.
    db.execute("DELETE FROM daily_checkins WHERE day = (now() AT TIME ZONE 'UTC')::date")
    db.execute("""UPDATE push_subscriptions SET last_sent_day = NULL,
                  remind_hour = LEAST(23, extract(hour FROM now() AT TIME ZONE 'UTC')::int + 1)""")
    hour_now = db.execute("SELECT extract(hour FROM now() AT TIME ZONE 'UTC')::int").fetchone()[0]
    send_reminders.main()
    if hour_now < 23:
        assert received == [], received

print("REMINDER_TESTS_OK")
