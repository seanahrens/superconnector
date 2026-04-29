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
$WRANGLER d1 migrations apply superconnector --remote
green "  migrations up to date"

# ──────────────────────────────────────────────────────────────────────────────
# 6. Secrets
# ──────────────────────────────────────────────────────────────────────────────
bold "▸ provisioning secrets"

secret_already_set() {
  $WRANGLER secret list --format=json 2>/dev/null \
    | node -e "
      let s = require('fs').readFileSync(0, 'utf8');
      let j; try { j = JSON.parse(s); } catch { process.exit(1); }
      process.exit(j.find(x => x.name === '$1') ? 0 : 1);
    " >/dev/null
}

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
}

generate_and_set_secret() {
  local name=$1
  local cache="$SECRETS_CACHE/$name"
  local value
  if [ -f "$cache" ]; then
    value=$(cat "$cache")
  else
    value=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")
    printf '%s' "$value" > "$cache"
    chmod 600 "$cache"
  fi
  if secret_already_set "$name"; then
    dim "  $name (already set)"
  else
    printf '%s' "$value" | $WRANGLER secret put "$name" >/dev/null
    green "  $name (generated and set)"
  fi
  printf '%s' "$value"
}

prompt_secret ANTHROPIC_API_KEY  "https://console.anthropic.com/settings/keys"
prompt_secret GRANOLA_API_KEY    "Granola Business plan API settings"
prompt_secret PROTON_ICS_URL     "Proton Calendar > Settings > Share via link URL"
prompt_secret RESEND_API_KEY     "https://resend.com/api-keys"
prompt_secret EMAIL_TO           "your inbox (daily-email recipient)"
prompt_secret EMAIL_FROM         "verified Resend sender (you@yourdomain.com)"

mcp_secret=$(generate_and_set_secret MCP_SECRET)
web_auth_secret=$(generate_and_set_secret WEB_AUTH_SECRET)

# ──────────────────────────────────────────────────────────────────────────────
# 7. Deploy worker, capture URL
# ──────────────────────────────────────────────────────────────────────────────
bold "▸ deploying Worker"
worker_out=$($WRANGLER deploy 2>&1)
printf '%s\n' "$worker_out" | tail -10
worker_url=$(printf '%s\n' "$worker_out" | grep -oE 'https://[a-zA-Z0-9._-]+\.workers\.dev' | head -1 || true)
if [ -z "$worker_url" ]; then
  warn "  could not detect Worker URL from deploy output; you'll need to set it manually"
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

# Update pages/wrangler.toml's [vars] block (idempotent).
node -e "
  const fs = require('fs');
  const p = 'pages/wrangler.toml';
  let s = fs.readFileSync(p, 'utf8');
  const block = \`[vars]
PUBLIC_API_BASE = \\\"$worker_url\\\"
PUBLIC_API_TOKEN = \\\"$web_auth_secret\\\"
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
(cd pages && npm run build && $WRANGLER deploy 2>&1 | tail -15)
green "  pages deployed"

# ──────────────────────────────────────────────────────────────────────────────
# 10. Done
# ──────────────────────────────────────────────────────────────────────────────
echo
green "✓ setup complete"
echo
echo "  Worker:  $worker_url"
echo "  MCP:     $worker_url/mcp  (bearer in .secrets/MCP_SECRET)"
echo "  Auth:    .secrets/WEB_AUTH_SECRET"
echo
echo "  Add to Claude Desktop's mcpServers config:"
cat <<EOF
    "superconnector": {
      "command": "npx",
      "args": ["mcp-remote", "$worker_url/mcp",
               "--header", "Authorization:Bearer $mcp_secret"]
    }
EOF
echo
echo "  For production access control, put Cloudflare Access in front of both URLs."
