#!/bin/zsh
set -euo pipefail

cd "${0:A:h}/.."
exec node scripts/push-cloudflare-secrets.mjs
