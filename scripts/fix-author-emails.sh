#!/usr/bin/env bash
# Rewrite author/committer emails on every commit to remove the
# attribution-squatting "Chinnybest321" from the GitHub contributor list.
#
# Run this from the root of the sleep-med-timer git checkout. It rewrites
# history (every commit gets a new SHA) and force-pushes to origin/main.
set -euo pipefail

OLD_EMAIL='noreply@anthropic.com'
NEW_EMAIL='claude@users.noreply.github.com'

if [ ! -d .git ]; then
    echo "error: must be run from the root of a git repository" >&2
    exit 1
fi

export FILTER_BRANCH_SQUELCH_WARNING=1

git filter-branch -f --env-filter "
  if [ \"\$GIT_AUTHOR_EMAIL\" = \"$OLD_EMAIL\" ]; then
    export GIT_AUTHOR_EMAIL=\"$NEW_EMAIL\"
  fi
  if [ \"\$GIT_COMMITTER_EMAIL\" = \"$OLD_EMAIL\" ]; then
    export GIT_COMMITTER_EMAIL=\"$NEW_EMAIL\"
  fi
" -- --all

echo
echo "Rewrite complete. New author/committer emails on each commit:"
git log --format='  %h  author=%ae  committer=%ce' -10

echo
echo "Force-pushing main to origin..."
git push --force origin main

echo
echo "Done. The contributor sidebar on GitHub may take a few minutes"
echo "to refresh, but Chinnybest321 should drop off."
