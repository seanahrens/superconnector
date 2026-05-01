#!/usr/bin/env bash
# Capture a Time Travel restore point for the D1 database.
#
# D1's Time Travel keeps a continuous restore log for the last 30 days. This
# script just appends the current UTC timestamp to backups/restore-points.log
# so you have an exact rollback target if the next operation goes wrong.
#
# Usage:
#   scripts/restore-point.sh                        # logs an unlabelled point
#   scripts/restore-point.sh "before-deploy"        # logs with a label
#
# To restore (only the last 30 days are restorable):
#   npx wrangler d1 time-travel restore superconnector --timestamp=<line>
#
# The .log file is gitignored. It lives only on your Mac.

set -euo pipefail

cd "$(dirname "$0")/.."

label=${1:-}
ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
mkdir -p backups
line="$ts${label:+  $label}"
printf '%s\n' "$line" >> backups/restore-points.log

printf '\033[2m▸ restore point logged: %s\033[0m\n' "$line"
