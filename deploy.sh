#!/usr/bin/env bash

set -e

REPO="/opt/mysite"
BRANCH="main"
OPENRESTY="/usr/local/openresty/bin/openresty"

echo "Starting deployment..."

# Enter repository
cd "$REPO"

# Fetch latest changes
echo "Fetching latest changes..."
git fetch origin "$BRANCH"

# Update local repository (only fast-forward)
echo "Updating repository..."
git merge --ff-only "origin/$BRANCH"

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