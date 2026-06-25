# Testing

OmniProject's automated tests are organised around five pillars. The whole battery
runs in CI on every PR (`.github/workflows/ci.yml`) and locally with one command:

```bash
pnpm test:regression
```

Individual layers:

```bash
pnpm test                                   # gateway + SPA unit tests (all packages)
pnpm test:coverage                          # same, with the c8 / v8 coverage gates
pnpm --filter @workspace/api-server run test:coverage   # gateway only, with c8 gate
pnpm --filter @workspace/omniproject run test:coverage  # SPA only, with v8 gate
pnpm --filter @workspace/scripts run verify-n8n     # contract verification (mock n8n)
pnpm --filter @workspace/scripts run e2e-smoke      # SPA shell + read journey
pnpm --filter @workspace/scripts run a11y           # accessibility (see below)
pnpm --filter @workspace/scripts run stress         # load test (run separately)
```

Both unit suites enforce a **coverage gate** (a ratchet set just below current
coverage so it can't regress, raised as tests are added): the **gateway** via
`c8` (`.c8rc.json`) at **~84% lines / 87% functions** (235 tests), the **SPA**
via Vitest + React Testing Library + jsdom (`vitest.config.ts`) at **~89% lines /
88% branches** (341 tests). Both gates run in the CI `verify` job.

## The five pillars

### 1. Technical completeness
- **Contract is the source of truth**: CI regenerates `lib/api-zod` + `lib/api-client-react`
  from `lib/api-spec/openapi.yaml` and fails on drift.
- **Every OpenAPI path is covered** — [`contract-coverage.test.ts`](../artifacts/api-server/src/__tests__/contract-coverage.test.ts)
  fails CI when a new path is added without a registered test.
- **Every Broker method is exercised** — [`broker-conformance.test.ts`](../artifacts/api-server/src/__tests__/broker-conformance.test.ts)
  runs the full `Broker` contract against `DemoBroker` (the suite any future broker must also pass).
- **Architecture invariants** — [`broker-guard.test.ts`](../artifacts/api-server/src/__tests__/broker-guard.test.ts)
  (no n8n leakage above the seam) and [`deploy-guard.test.ts`](../artifacts/api-server/src/__tests__/deploy-guard.test.ts)
  (deploy files don't drift).
- Both builds (gateway + SPA) run in CI.

### 2. Security
[`security.test.ts`](../artifacts/api-server/src/__tests__/security.test.ts) drives the
**real Express app over HTTP** and asserts the protections HOLD — these tests only
ever tighten:
- unauthenticated → `401`;
- **RBAC**: a viewer cannot create issues or change settings (`403`); an admin clears the gate;
- **read-only API tokens**: can `GET`, cannot mutate (`403`); an invalid token → `401`;
- **baseline security headers** present (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, HSTS in prod).

Further security coverage lives in the contract verifier and unit tests: optimistic
concurrency (`409`), idempotency/loop-guard, JWKS/forged-token rejection, premium
`402` paywall gating, payment-webhook signature rejection, secret redaction, and the
notification-ingest secret.

### 3. Accessibility
[`scripts/a11y-scan.cjs`](../scripts/a11y-scan.cjs) runs **axe-core (WCAG 2.1 A/AA)** over
the built SPA in a real browser and fails on any violation. Playwright + axe-core
aren't workspace deps (the SPA doesn't ship them), so the scanner resolves them via
`require`/`NODE_PATH` and **skips cleanly (exit 0)** if they aren't installed — it
never breaks the default run. To run it for real (no lockfile churn):

```bash
mkdir -p /tmp/a11y && (cd /tmp/a11y && npm i playwright axe-core)
# build the SPA, boot the gateway with STATIC_DIR=artifacts/omniproject/dist/public, then:
NODE_PATH=/tmp/a11y/node_modules A11Y_BASE=http://localhost:3000 pnpm --filter @workspace/scripts run a11y
```

CI runs this in the `accessibility` job (installs the browser tooling into a
throwaway dir on demand).

### 4. User experience / flows
[`e2e-smoke.ts`](../scripts/src/e2e-smoke.ts) verifies the SPA shell is served, demo
login issues a cookie, and the read journey (projects → issues → summary →
capabilities → fx → notifications → portfolio) works end to end. Write journeys
(create/update/delete, governance, premium) are exercised by the contract verifier.

**SPA component/unit tests** (Vitest + React Testing Library + jsdom, under
`artifacts/omniproject/src/**/*.test.{ts,tsx}`) cover the critical flows and the
behaviours hardened in review: error/retry rendering (`DataState`), the render
error boundary, store persistence (active project + theme), inline validation,
`IssueDialog` accessible-name associations, the backend-agnostic board column
derivation, and the Projects completion-from-list-row counts. A
`renderWithProviders` helper (`src/test/utils.tsx`) wraps a fresh, retry-disabled
QueryClient so caches are seeded with `setQueryData` instead of hitting the network.

### 5. Regression
`pnpm test:regression` ([`run-regression.sh`](../scripts/run-regression.sh)) runs the
full deterministic battery — typecheck → unit + guards → builds → boot gateway →
contract verify → e2e smoke → accessibility — mirroring CI so local == CI. The
performance-thresholded `stress` test is run separately.

## Conventions
- Gateway tests: `node:test` via `tsx --test "src/**/*.test.ts"`, `node:assert/strict`.
  HTTP-level tests boot the real `app` on an ephemeral port; module-level tests
  import `lib/*`/`broker/*` directly. Set/restore env in `try/finally`.
- Black-box scripts: `@workspace/scripts`, run against a gateway at `OMNI_API_BASE`.
- New endpoint? Add it to `openapi.yaml`, run codegen, write a test, and register the
  path in `contract-coverage.test.ts` — CI enforces all three.

## Known env-gated / non-blocking
- `integration:openproject` — live cert; **skips (exit 0)** without `OPENPROJECT_LIVE_URL`/`OPENPROJECT_TOKEN`.
- `a11y` — **skips (exit 0)** without Playwright + axe-core installed.
- `stress` — performance-thresholded; the most runner-sensitive, run on demand.
