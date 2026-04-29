#!/usr/bin/env bash
# Re-deploy both the Worker and the SvelteKit Pages app.
# Use after making code changes; setup.sh is for first-time provisioning.

set -euo pipefail

cd "$(dirname "$0")/.."

WRANGLER="npx --yes wrangler@4"

echo "▸ Worker"
$WRANGLER deploy

echo "▸ Pages"
(cd pages && npm run build && $WRANGLER deploy)
