#!/bin/zsh
set -euo pipefail

cd "${0:A:h}/.."
set -a
source .env.local
set +a

secrets=(
  AIRTABLE_ACCESS_TOKEN
  AIRTABLE_BASE_ID
  ENCRYPTION_KEY
  POSTHOG_KEY
  RESEND_API_KEY
  SESSION_SECRET
  TURNSTILE_SECRET_KEY
)

# RESEND_WEBHOOK_SECRET is endpoint-specific and is rotated directly between
# the authenticated Resend and Cloudflare dashboards. Excluding it from this
# bulk helper prevents an older local value from replacing the active secret.

uploaded=0
for secret_name in $secrets; do
  secret_value="${(P)secret_name:-}"
  if [[ -z "$secret_value" ]]; then
    print -u2 "Skipping unset value: $secret_name"
    continue
  fi
  print -rn -- "$secret_value" | npx wrangler secret put "$secret_name"
  (( uploaded += 1 ))
done

print "Uploaded $uploaded ProgramLoom secrets without printing their values."
