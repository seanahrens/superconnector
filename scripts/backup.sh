#!/usr/bin/env bash
# Export the remote D1 database to a gzipped SQL file under backups/.
# Run monthly (or whenever you want a snapshot beyond Time Travel's 30-day
# window). Cheap to run: a single `wrangler d1 export` against the remote DB.
#
# Usage:
#   scripts/backup.sh
#
# Output:
#   backups/superconnector-YYYY-MM-DD.sql.gz
#
# Restoring from a dump:
#   gunzip -c backups/superconnector-2026-04-01.sql.gz \
#     | npx wrangler d1 execute superconnector --remote --file=/dev/stdin
#
# Tip: schedule via launchd on your Mac if you want it automatic. Example
# plist at the bottom of docs/GOTCHAS.md (search "monthly backup").

set -euo pipefail

cd "$(dirname "$0")/.."

WRANGLER="npx --yes wrangler@4"
mkdir -p backups
date_str=$(date -u +"%Y-%m-%d")
out="backups/superconnector-${date_str}.sql"

printf '\033[1m▸ exporting D1 → %s\033[0m\n' "${out}.gz"
$WRANGLER d1 export superconnector --remote --output="$out"

gzip -f "$out"
size=$(du -h "${out}.gz" | cut -f1)
printf '\033[32m✓ wrote %s (%s)\033[0m\n' "${out}.gz" "$size"

# Also log a Time Travel restore point so you have both options if something
# goes sideways before the next monthly run.
"$(dirname "$0")"/restore-point.sh "monthly-backup-${date_str}"
