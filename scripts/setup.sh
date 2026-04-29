#!/usr/bin/env bash
# One-shot Cloudflare provisioning + first deploy.
#
# Idempotent: re-running skips work that's already done. The only manual step
# you need to do once before this is `npx wrangler login` (opens a browser).
#
# Inputs you'll be prompted for (only the first time, and only those that
# can't be auto-generated):
#   - ANTHROPIC_API_KEY    https://console.anthropic.com/settings/keys
#   - GRANOLA_API_KEY      Granola Business plan settings
#   - PROTON_ICS_URL       Proton Calendar > Settings > Calendar > "Share via link" URL
#   - RESEND_API_KEY       https://resend.com/api-keys
#   - EMAIL_TO             your inbox (the daily-email recipient)
#   - EMAIL_FROM           verified Resend sender, e.g. you@yourdomain.com
#
# Auto-generated and written for you:
#   - MCP_SECRET, WEB_AUTH_SECRET (random 192-bit base64url)
#   - D1 database id, patched into wrangler.toml
#   - pages/.env (for local dev) and pages/wrangler.toml [vars] (for deploy)
#
# Re-running after the first time will only top up missing pieces.

set -euo pipefail

cd "$(dirname "$0")/.."

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }
warn()  { printf '\033[33m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

WRANGLER="npx --yes wrangler@4"
SECRETS_CACHE=".secrets"
mkdir -p "$SECRETS_CACHE"
chmod 700 "$SECRETS_CACHE"

# ──────────────────────────────────────────────────────────────────────────────
# 1. Auth check
# ──────────────────────────────────────────────────────────────────────────────
bold "▸ checking Cloudflare auth"
if ! $WRANGLER whoami >/dev/null 2>&1; then
  warn "  not logged in. Run: npx wrangler login"
  exit 1
fi
dim "  logged in"

# ──────────────────────────────────────────────────────────────────────────────
# 2. Install deps
# ──────────────────────────────────────────────────────────────────────────────
bold "▸ installing deps"
[ -d node_modules ] || npm install
[ -d pages/node_modules ] || (cd pages && npm install)
dim "  done"

# ──────────────────────────────────────────────────────────────────────────────
# 3. D1 database
# ──────────────────────────────────────────────────────────────────────────────
bold "▸ ensuring D1 database 'superconnector' exists"
db_id=""
if grep -q 'REPLACE_WITH_D1_ID' wrangler.toml; then
  out=$($WRANGLER d1 create superconnector 2>&1) || true
  db_id=$(printf '%s\n' "$out" | grep -oE 'database_id\s*=\s*"[^"]+"' | head -1 | sed 's/.*"\(.*\)"/\1/' || true)
  if [ -z "$db_id" ]; then
    # Already exists — look it up.
    list=$($WRANGLER d1 list --json 2>/dev/null || $WRANGLER d1 list)
    db_id=$(node -e "
      let s = require('fs').readFileSync(0, 'utf8');
      let j; try { j = JSON.parse(s); } catch { process.exit(0); }
      const r = (Array.isArray(j) ? j : (j.result ?? [])).find(x => x.name === 'superconnector');
      if (r) console.log(r.uuid ?? r.database_id ?? '');
    " <<<"$list")
  fi
  if [ -z "$db_id" ]; then
    warn "  could not determine database_id"
    printf '%s\n' "$out"
    exit 1
  fi
  # Patch wrangler.toml.
  perl -i -pe "s|REPLACE_WITH_D1_ID|$db_id|g" wrangler.toml
  green "  wired database_id $db_id into wrangler.toml"
else
  dim "  already configured in wrangler.toml"
fi

# ──────────────────────────────────────────────────────────────────────────────
# 4. Vectorize index
# ──────────────────────────────────────────────────────────────────────────────
bold "▸ ensuring Vectorize index 'people-context' exists"
if ! $WRANGLER vectorize get people-context >/dev/null 2>&1; then
  $WRANGLER vectorize create people-context --dimensions=768 --metric=cosine
else
  dim "  already exists"
fi

# ──────────────────────────────────────────────────────────────────────────────
# 5. Apply migrations
# ──────────────────────────────────────────────────────────────────────────────
bold "▸ applying D1 migrations (remote)"
# Single 'y' (not `yes |`, which hits SIGPIPE under `set -o pipefail` when
# wrangler has nothing to apply and exits before reading any input).
printf 'y\n' | $WRANGLER d1 migrations apply superconnector --remote
green "  migrations up to date"

# ──────────────────────────────────────────────────────────────────────────────
# 6. Secrets
# ──────────────────────────────────────────────────────────────────────────────
bold "▸ provisioning secrets"

# Remove RESEND_API_KEY from older deploys (now using Cloudflare Email Workers).
$WRANGLER secret list --format=json 2>/dev/null \
  | node -e "
    let s = require('fs').readFileSync(0, 'utf8');
    let j; try { j = JSON.parse(s); } catch { process.exit(1); }
    process.exit(j.find(x => x.name === 'RESEND_API_KEY') ? 0 : 1);
  " >/dev/null \
  && { dim "  removing legacy RESEND_API_KEY"; $WRANGLER secret delete RESEND_API_KEY --force 2>/dev/null || true; } \
  || true

secret_already_set() {
  $WRANGLER secret list --format=json 2>/dev/null \
    | node -e "
      let s = require('fs').readFileSync(0, 'utf8');
      let j; try { j = JSON.parse(s); } catch { process.exit(1); }
      process.exit(j.find(x => x.name === '$1') ? 0 : 1);
    " >/dev/null
}

# Captured from interactive prompts so we can use them in the final printout.
EMAIL_FROM_VALUE=""
EMAIL_TO_VALUE=""

prompt_secret() {
  local name=$1 hint=$2
  if secret_already_set "$name"; then
    dim "  $name (already set)"
    return
  fi
  printf '  %s — %s\n' "$(bold "$name")" "$hint"
  printf '    paste value (or empty to skip): '
  # Use stty to hide tokens; allow plain values like emails to remain visible.
  local value
  read -r value
  if [ -z "$value" ]; then
    warn "    skipped"
    return
  fi
  printf '%s' "$value" | $WRANGLER secret put "$name" >/dev/null
  green "    set"
  case "$name" in
    EMAIL_FROM) EMAIL_FROM_VALUE="$value" ;;
    EMAIL_TO)   EMAIL_TO_VALUE="$value" ;;
  esac
}

generate_and_set_secret() {
  local name=$1
  local cache="$SECRETS_CACHE/$name"
  if [ ! -f "$cache" ]; then
    # process.stdout.write to avoid the trailing newline that console.log adds.
    node -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64url'))" > "$cache"
    chmod 600 "$cache"
  fi
  if secret_already_set "$name"; then
    dim "  $name (already set)"
  else
    cat "$cache" | $WRANGLER secret put "$name" >/dev/null
    green "  $name (generated and set)"
  fi
}

prompt_secret ANTHROPIC_API_KEY  "https://console.anthropic.com/settings/keys"
prompt_secret GRANOLA_API_KEY    "Granola Business plan API settings"
prompt_secret PROTON_ICS_URL     "Proton Calendar > Settings > Share via link URL"
prompt_secret EMAIL_TO           "your inbox (verified destination in Cloudflare Email Routing)"
prompt_secret EMAIL_FROM         "any address on a CF-routed domain you control (e.g. daily@yourdomain.com)"

generate_and_set_secret MCP_SECRET
generate_and_set_secret WEB_AUTH_SECRET
mcp_secret=$(cat "$SECRETS_CACHE/MCP_SECRET")
web_auth_secret=$(cat "$SECRETS_CACHE/WEB_AUTH_SECRET")

# ──────────────────────────────────────────────────────────────────────────────
# 7. Deploy worker, capture URL
# ──────────────────────────────────────────────────────────────────────────────
bold "▸ deploying Worker"
deploy_log=$(mktemp)
trap 'rm -f "$deploy_log"' EXIT
# Stream live so the user can see prompts/errors; tee to a log so we can grep
# the URL afterwards. PIPESTATUS preserves wrangler's real exit code.
$WRANGLER deploy 2>&1 | tee "$deploy_log"
deploy_status=${PIPESTATUS[0]}
if [ "$deploy_status" -ne 0 ]; then
  warn "  worker deploy failed (exit $deploy_status). See output above."
  exit "$deploy_status"
fi
# Strip ANSI escapes and any \r before grepping, so the captured URL never
# contains control chars that would break the downstream TOML write.
worker_url=$(sed 's/\x1b\[[0-9;]*m//g; s/\r//g' "$deploy_log" \
              | grep -oE 'https://[a-zA-Z0-9._-]+\.workers\.dev' \
              | head -1 || true)
if [ -z "$worker_url" ]; then
  warn "  could not detect Worker URL from deploy output; using placeholder"
  worker_url="https://REPLACE_WITH_WORKER_URL"
fi
green "  deployed at $worker_url"

# ──────────────────────────────────────────────────────────────────────────────
# 8. Pages env (local + deployed)
# ──────────────────────────────────────────────────────────────────────────────
bold "▸ wiring SvelteKit Pages env"
cat > pages/.env <<EOF
PUBLIC_API_BASE="$worker_url"
PUBLIC_API_TOKEN="$web_auth_secret"
EOF
chmod 600 pages/.env
dim "  wrote pages/.env"

# Update pages/wrangler.toml's [vars] block (idempotent). Pass values via env
# vars rather than bash-interpolating into the script body — avoids shell
# escaping pitfalls and lets us strip any stray control chars in JS.
WORKER_URL="$worker_url" WEB_AUTH_SECRET="$web_auth_secret" node -e "
  const fs = require('fs');
  const p = 'pages/wrangler.toml';
  const sanitize = (s) => s.replace(/[\x00-\x1f]+/g, '').trim();
  const url = sanitize(process.env.WORKER_URL);
  const tok = sanitize(process.env.WEB_AUTH_SECRET);
  let s = fs.readFileSync(p, 'utf8');
  const block = \`[vars]
PUBLIC_API_BASE = \"\${url}\"
PUBLIC_API_TOKEN = \"\${tok}\"
\`;
  if (s.includes('[vars]')) {
    s = s.replace(/\[vars\][\s\S]*?(?=\n\[|\n*$)/, block);
  } else {
    s = s.trimEnd() + '\n\n' + block;
  }
  fs.writeFileSync(p, s);
"
dim "  updated pages/wrangler.toml [vars]"

# ──────────────────────────────────────────────────────────────────────────────
# 9. Build + deploy Pages
# ──────────────────────────────────────────────────────────────────────────────
bold "▸ building and deploying SvelteKit"
pages_log=$(mktemp)
( cd pages && npm run build && $WRANGLER deploy 2>&1 ) | tee "$pages_log"
pages_status=${PIPESTATUS[0]}
if [ "$pages_status" -ne 0 ]; then
  warn "  pages deploy failed (exit $pages_status). See output above."
  rm -f "$pages_log"
  exit "$pages_status"
fi
pages_url=$(grep -oE 'https://[a-zA-Z0-9._-]+\.pages\.dev' "$pages_log" | head -1 || true)
[ -n "$pages_url" ] || pages_url=$(grep -oE 'https://[a-zA-Z0-9._-]+\.workers\.dev' "$pages_log" | tail -1 || true)
rm -f "$pages_log"
green "  pages deployed at ${pages_url:-(URL not detected — check output above)}"

# ──────────────────────────────────────────────────────────────────────────────
# 10. Done
# ──────────────────────────────────────────────────────────────────────────────

# Derive the EMAIL_FROM domain (e.g. "mapendar.com" from "daily@mapendar.com")
# for a clickable dashboard link.
email_from_domain=""
if [ -n "$EMAIL_FROM_VALUE" ] && printf '%s' "$EMAIL_FROM_VALUE" | grep -q '@'; then
  email_from_domain="${EMAIL_FROM_VALUE#*@}"
fi
email_routing_url="https://dash.cloudflare.com/?to=/:account/${email_from_domain:-yourdomain.com}/email/routing"
access_url="https://one.dash.cloudflare.com/?to=/:account/access/apps"

echo
green "✓ setup complete"
echo
bold "Deployed:"
echo "  Worker:    $worker_url"
echo "  Pages:     ${pages_url:-(check output above)}"
echo "  MCP:       $worker_url/mcp"
echo "  Health:    $worker_url/health"
echo
bold "Local secret cache (gitignored, keep safe):"
echo "  .secrets/MCP_SECRET"
echo "  .secrets/WEB_AUTH_SECRET"
echo
bold "──────────────────────────────────────────────────────────────────"
bold "Next steps (one-time, manual — Cloudflare can't automate these):"
bold "──────────────────────────────────────────────────────────────────"
echo
echo "1. Enable Email Routing on ${email_from_domain:-your domain} so the daily email can send."
echo "   Open: $email_routing_url"
echo "   Click: 'Get started' (auto-adds MX + TXT records)."
echo "   Then: Destination addresses tab → Add → ${EMAIL_TO_VALUE:-your inbox} → click verification email."
echo "   Until this is done, the 06:00 PT daily-email cron will silently skip sends."
echo
echo "2. Add the MCP server to Claude Desktop."
echo "   File: ~/Library/Application Support/Claude/claude_desktop_config.json"
echo "   Paste inside the top-level \"mcpServers\" object:"
echo
cat <<EOF
       "superconnector": {
         "command": "npx",
         "args": ["mcp-remote", "$worker_url/mcp",
                  "--header", "Authorization:Bearer $mcp_secret"]
       }
EOF
echo
echo "   Then quit and reopen Claude Desktop."
echo
echo "3. (Optional, recommended) Put Cloudflare Access in front of the Worker"
echo "   and Pages URLs for real protection. Free for ≤50 users."
echo "   Open: $access_url"
echo
bold "Verify:"
echo "  curl $worker_url/health"
echo "  # → {\"status\":\"ok\",\"db\":\"reachable\",…}"
echo
echo "  # Trigger an ingest run:"
echo "  curl -X POST -H \"Authorization: Bearer \$(cat .secrets/WEB_AUTH_SECRET)\" \\"
echo "       $worker_url/api/run/ingest"
echo
echo "  # Trigger the daily email (after step 1):"
echo "  curl -X POST -H \"Authorization: Bearer \$(cat .secrets/WEB_AUTH_SECRET)\" \\"
echo "       $worker_url/api/run/daily-email"
