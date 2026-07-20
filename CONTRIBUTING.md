# Contributing to OmniProject

Thanks for your interest in OmniProject. This is an early-stage, open-core
project and contributions are welcome — bug reports, docs, backends, and
features all help.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Bugs / features:** open an issue first (use the templates) so we can agree on
  the approach before you invest time. For anything security-related, **do not**
  open a public issue — see [SECURITY.md](SECURITY.md).
- **Licensing of contributions:** the core is Apache-2.0; some files are premium
  (header tag `LicenseRef-OmniProject-Premium`, see [LICENSING.md](LICENSING.md)).
  By submitting a PR you agree your contribution is licensed under the licence
  that already applies to the file(s) you change.

## Branching

Base your work on **`next`**, not `main`. `main` is the stable release line; `next` is the
standing development branch that sits one step ahead and is kept green. Dependency-bump PRs
target `next` too. Full flow (promotion, the `next` re-seat ritual, hotfixes) is in
**[docs/BRANCHING.md](docs/BRANCHING.md)**.

## Development setup

Requires **Node 26+** and **pnpm 11.8+** (`corepack enable`).

```bash
pnpm install
```

The repo is a pnpm-workspace monorepo. Common commands:

```bash
# Typecheck / test / build a package (filters: @workspace/api-server, omniproject, @workspace/scripts)
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server exec tsx --test "src/**/*.test.ts"   # unit tests
pnpm --filter @workspace/api-server run build
PORT=3000 BASE_PATH=/ pnpm --filter omniproject run build               # SPA build

# Live n8n contract verification (starts a mock n8n; needs the gateway running)
PORT=5000 node artifacts/api-server/dist/index.mjs &
OMNI_API_BASE=http://localhost:5000 pnpm --filter @workspace/scripts run verify-broker
```

Copy [`.env.example`](.env.example) to `.env` to configure — with nothing set the
gateway runs in stateless **demo mode** (sample data, no SSO), which is the
easiest way to develop.

## Contract-first codegen

The API is contract-first. **Never hand-edit generated folders** (`lib/api-zod`,
`lib/api-client-react`). Change [`lib/api-spec/openapi.yaml`](lib/api-spec) then:

```bash
pnpm --filter @workspace/api-spec run codegen
```

CI fails on codegen drift, so commit the regenerated output.

## Pull requests

1. Branch off `main` (e.g. `feature/…`, `fix/…`).
2. Keep changes focused; match the surrounding code style (the codebase favours
   small, well-commented, dependency-light modules).
3. Make sure **typecheck, unit tests, builds and `verify-broker` all pass** — these
   are the core checks CI (`.github/workflows/ci.yml`) runs; CI additionally runs
   coverage gates, drift-guards, security scans (secret-scan, taint-scan, CodeQL),
   accessibility and e2e.
4. Add tests for new logic and update docs (`docs/TECHNICAL.md`, READMEs) when
   behaviour changes.
5. Open the PR against `main` and fill in the template.

## Adding a backend

Backends are declarative. Add a JSON manifest under
[`lib/backend-catalogue/vendors/backends/`](lib/backend-catalogue/vendors/backends/)
(run `pnpm --filter @workspace/scripts run gen-vendors` to embed it) and the
generator emits an importable n8n workflow — see
[docs/N8N-WORKFLOWS.md](docs/N8N-WORKFLOWS.md). Standard backends are free; the
large ERPs (SAP, Primavera, …) are gated as enterprise — match the existing
pattern. Every manifest must declare a `verification` status
(`verified`/`catalogued`/`experimental`) — see
[vendors/README.md#verification-status](lib/backend-catalogue/vendors/README.md#verification-status).

**The catalogue is currently frozen at 41 backends** — `gen-vendors` refuses to
embed a 42nd+ until `jira`, `asana`, `salesforce`, `servicenow` and `sap` are all
`verified` against a live instance. See
[vendors/README.md#catalogue-freeze](lib/backend-catalogue/vendors/README.md#catalogue-freeze)
for the rationale and how to verify one of the flagship five instead of adding a
new one.

## Project status

OmniProject is **pre-1.0** and provided **as is, without warranty** (see the
[README](README.md#license--status)). There is no formal support yet; help is
best-effort via GitHub issues and discussions.
