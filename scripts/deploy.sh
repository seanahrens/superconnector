#!/usr/bin/env bash
# Re-deploy both the Worker and the SvelteKit Pages app.
# Use after making code changes; setup.sh is for first-time provisioning.

set -euo pipefail

cd "$(dirname "$0")/.."

WRANGLER="npx --yes wrangler@4"

# Log a D1 Time Travel restore point so the timestamp before this deploy is
# captured in backups/restore-points.log. Cheap insurance: if this deploy
# breaks ingest or clobbers data, you have an exact rollback target within
# the 30-day Time Travel window.
"$(dirname "$0")"/restore-point.sh "before-deploy"

echo "▸ Worker"
$WRANGLER deploy

echo "▸ Pages"
(cd pages && npm run build && $WRANGLER deploy)
