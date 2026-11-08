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

# Test OpenResty configuration
echo "Testing OpenResty configuration..."
sudo "$OPENRESTY" -t

# Reload OpenResty
echo "Reloading OpenResty..."
sudo "$OPENRESTY" -s reload

echo "Deployment successful!"