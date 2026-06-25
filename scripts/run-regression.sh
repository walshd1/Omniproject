#!/usr/bin/env bash
#
# Full regression battery — the same checks CI runs, in one command, for local
# pre-release confidence. Mirrors .github/workflows/ci.yml so `local == CI`.
#
#   pnpm test:regression
#
# The accessibility step is dependency-soft: it skips cleanly if Playwright +
# axe-core aren't installed (see scripts/src/a11y.ts).
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${REGRESSION_PORT:-5070}"
export NOTIFY_INGEST_SECRET="${NOTIFY_INGEST_SECRET:-omni-verify-secret}"

step() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

step "Typecheck (libs + apps + scripts)"
pnpm run typecheck

step "Unit tests + guards (gateway): security, RBAC, broker conformance, contract coverage, arch/deploy guards"
pnpm --filter @workspace/api-server run test

step "Build gateway + SPA"
pnpm --filter @workspace/api-server run build
PORT=3000 BASE_PATH=/ pnpm --filter omniproject run build

step "Boot gateway (demo mode, serving the built SPA)"
STATIC_DIR="$PWD/artifacts/omniproject/dist/public" PORT="$PORT" \
  node artifacts/api-server/dist/index.mjs &
GW=$!
trap 'kill "$GW" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  curl -fsS "http://localhost:$PORT/api/healthz" >/dev/null 2>&1 && break
  sleep 1
done
export OMNI_API_BASE="http://localhost:$PORT"

step "Contract verification (bidirectional, mock n8n)"
pnpm --filter @workspace/scripts run verify-n8n

step "E2E smoke (SPA shell + read journey)"
pnpm --filter @workspace/scripts run e2e-smoke

step "Accessibility (WCAG 2.1 A/AA via axe-core; skips if tooling absent)"
A11Y_BASE="$OMNI_API_BASE" pnpm --filter @workspace/scripts run a11y

printf '\n\033[1;32m✓ ALL REGRESSION CHECKS PASSED\033[0m\n'
printf 'Note: the load/stress test (pnpm --filter @workspace/scripts run stress) is\n'
printf 'run separately — it is performance-thresholded and the most runner-sensitive.\n'
