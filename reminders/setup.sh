#!/usr/bin/env bash
# One-time setup for daily reminders. Run on the server as the deploy user,
# with sudo:
#
#   sudo bash /opt/mysite/reminders/setup.sh
#
# It is safe to run again (for example after changing requirements.txt):
# existing keys are kept.
#
# What it does:
#  1. Makes a Python virtual environment with pywebpush and psycopg.
#  2. Makes the VAPID key pair that signs push messages, once:
#     /etc/mysite/vapid_private.pem (secret) and /etc/mysite/vapid_public.txt.
#     Making a new pair later would break every existing subscription.
#  3. Installs and starts a systemd timer that runs send_reminders.py every
#     15 minutes as the deploy user.
# The next deploy copies the public key to where the site can read it.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "Run this with sudo: sudo bash $0" >&2
    exit 1
fi

RUN_AS="${SUDO_USER:-}"
if [[ -z "$RUN_AS" || "$RUN_AS" == "root" ]]; then
    echo "Run this with sudo from the deploy user's account, not as root directly." >&2
    exit 1
fi

REPO="/opt/mysite"
VENV="/opt/mysite-reminders/venv"
PRIVATE_KEY="/etc/mysite/vapid_private.pem"
PUBLIC_KEY="/etc/mysite/vapid_public.txt"

echo "1/3 Python environment..."
if ! python3 -m venv --help >/dev/null 2>&1; then
    echo "python3-venv is missing. Install it with: sudo apt install python3-venv" >&2
    exit 1
fi
mkdir -p "$(dirname "$VENV")"
[[ -d "$VENV" ]] || python3 -m venv "$VENV"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -r "$REPO/reminders/requirements.txt"
chown -R "$RUN_AS": "$(dirname "$VENV")"

echo "2/3 VAPID keys..."
mkdir -p /etc/mysite
if [[ ! -f "$PRIVATE_KEY" ]]; then
    "$VENV/bin/python" -I - "$PRIVATE_KEY" "$PUBLIC_KEY" <<'PY'
import base64, os, sys
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

private_path, public_path = sys.argv[1], sys.argv[2]
key = ec.generate_private_key(ec.SECP256R1())
pem = key.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
)
# Only the owner may read the private key.
fd = os.open(private_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "wb") as file:
    file.write(pem)
public = key.public_key().public_bytes(
    serialization.Encoding.X962,
    serialization.PublicFormat.UncompressedPoint,
)
with open(public_path, "w") as file:
    file.write(base64.urlsafe_b64encode(public).rstrip(b"=").decode() + "\n")
PY
    echo "   Made a new key pair."
else
    echo "   Keeping the existing key pair."
fi
chown "$RUN_AS": "$PRIVATE_KEY"
chmod 600 "$PRIVATE_KEY"
chmod 644 "$PUBLIC_KEY"

echo "3/3 systemd timer..."
sed "s/__RUN_AS__/$RUN_AS/" "$REPO/reminders/osiris-reminders.service" > /etc/systemd/system/osiris-reminders.service
cp "$REPO/reminders/osiris-reminders.timer" /etc/systemd/system/osiris-reminders.timer
systemctl daemon-reload
systemctl enable --now osiris-reminders.timer

echo
echo "Done. Deploy once more (or run deploy.sh) so the site picks up the public key."
echo "Check the sender with: systemctl status osiris-reminders.service"
echo "and its log with:      journalctl -u osiris-reminders.service"
