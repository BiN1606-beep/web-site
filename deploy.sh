#!/usr/bin/env bash

set -e

REPO="/opt/mysite"
BRANCH="main"
OPENRESTY="/usr/local/openresty/bin/openresty"

echo "Starting deployment..."

# Load database credentials for migrations when they are stored server-side.
if [[ -f /etc/mysite/deploy.env ]]; then
    set -a
    . /etc/mysite/deploy.env
    set +a
fi

: "${PGHOST:?PGHOST must be set for deployment}"
: "${PGDATABASE:?PGDATABASE must be set for deployment}"
: "${PGUSER:?PGUSER must be set for deployment}"
: "${PGPASSWORD:?PGPASSWORD must be set for deployment}"

if [[ -n "${DEBUG_MENU_EMAIL:-}" && ! "$DEBUG_MENU_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
    echo "DEBUG_MENU_EMAIL must be a valid email address." >&2
    exit 1
fi

# Enter repository
cd "$REPO"

# Fetch latest changes
echo "Fetching latest changes..."
git fetch origin "$BRANCH"

# Update local repository (only fast-forward)
echo "Updating repository..."
git merge --ff-only "origin/$BRANCH"

# Store the non-secret allowlist where OpenResty can read it without relying
# on the environment of an already-running master process.
debug_email_file="$REPO/lua/debug_menu_email.txt"
if [[ -n "${DEBUG_MENU_EMAIL:-}" ]]; then
    debug_email_tmp="$(mktemp "$REPO/lua/.debug_menu_email.XXXXXX")"
    printf '%s\n' "$DEBUG_MENU_EMAIL" > "$debug_email_tmp"
    chmod 644 "$debug_email_tmp"
    mv -f "$debug_email_tmp" "$debug_email_file"
else
    rm -f "$debug_email_file"
fi

# Apply pending database migrations before switching the running configuration.
echo "Running database migrations..."
"$REPO/db/migrate.sh"

# Test OpenResty configuration
echo "Testing OpenResty configuration..."
sudo "$OPENRESTY" -p "$REPO/" -c nginx.conf -t

# Reload OpenResty
echo "Reloading OpenResty..."
sudo "$OPENRESTY" -p "$REPO/" -c nginx.conf -s reload

echo "Deployment successful!"