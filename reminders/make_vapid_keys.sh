#!/bin/sh
# Makes the VAPID key pair that signs Osiris's push messages, once.
# deploy.sh runs it with sudo when the key is missing; nothing to do by hand.
#
#   sudo sh reminders/make_vapid_keys.sh [directory]   (default /etc/mysite)
#
# Writes <directory>/vapid_private.pem (root only, read by OpenResty's
# master process at start) and <directory>/vapid_public.txt (the public key
# browsers need, base64url). If the private key already exists it is kept:
# a new pair would break every reminder people have turned on.
# Needs only the openssl command, which Ubuntu has by default.

set -eu

DIR="${1:-/etc/mysite}"
PRIVATE_KEY="$DIR/vapid_private.pem"
PUBLIC_KEY="$DIR/vapid_public.txt"

if [ -f "$PRIVATE_KEY" ]; then
    echo "Keeping the existing VAPID key pair."
else
    mkdir -p "$DIR"
    umask 077
    tmp="$PRIVATE_KEY.tmp.$$"
    openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out "$tmp"
    chmod 600 "$tmp"
    mv "$tmp" "$PRIVATE_KEY"
    echo "Made a new VAPID key pair."
fi

# The public key is the last 65 bytes of the DER public key, as base64url.
umask 022
openssl pkey -in "$PRIVATE_KEY" -pubout -outform DER | tail -c 65 | openssl base64 -A \
    | tr '+/' '-_' | tr -d '=' > "$PUBLIC_KEY.tmp"
echo >> "$PUBLIC_KEY.tmp"
chmod 644 "$PUBLIC_KEY.tmp"
mv "$PUBLIC_KEY.tmp" "$PUBLIC_KEY"
