# Release checklist

A repeatable gate for cutting a release. Nothing here should be skipped silently —
if a step is N/A, say so in the release notes.

## 1. Green battery
- [ ] `pnpm test:regression` passes locally (typecheck → unit + guards → builds →
      contract verify → e2e smoke → accessibility).
- [ ] CI is green on `main` (`verify` + `deploy-lint` jobs).
- [ ] Accessibility: `a11y` reports **0 WCAG 2.1 A/AA violations** (the browser axe
      scan; the WCAG 2.2 AA gate is the jsdom axe suite — see [TESTING.md](TESTING.md)).
- [ ] Load test sane: `pnpm --filter @workspace/scripts run stress` within thresholds.

## 2. Security gate (must hold — never weaken to pass)
- [ ] `security.test.ts` green: 401 unauth, RBAC 403, read-only tokens, security headers.
- [ ] Premium features 402-gated when unlicensed; payment-webhook signatures verified.
- [ ] No secrets in the tree or history (`.env`, keys); `.dockerignore` excludes them.
- [ ] Deploy artifacts: `deploy-lint` green; required `${VAR:?}` documented in `.env.example`.

## 3. Contract & docs
- [ ] `openapi.yaml` ↔ generated client in sync (CI codegen-drift check).
- [ ] Every OpenAPI path registered in `contract-coverage.test.ts`.
- [ ] `CHANGELOG.md` updated; breaking changes flagged with upgrade notes.
- [ ] Version bump decided (pre-1.0 SemVer: breaking → minor).

## 4. Cut it
- [ ] Move `CHANGELOG` `[Unreleased]` → the new version section; fix compare links.
- [ ] Tag the release (un-prefixed: `0.2.0`, not `v0.2.0`) and publish the GitHub Release.
- [ ] Verify the published tag/release targets the intended commit.

## 5. Post-release
- [ ] Smoke the published artifact (demo mode boot: `node artifacts/api-server/dist/index.mjs`).
- [ ] Watch for issues; keep `[Unreleased]` updated as fixes land.
