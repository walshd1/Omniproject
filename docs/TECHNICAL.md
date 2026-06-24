# OmniProject — Technical Reference

Audience: **IT, platform engineers, and implementers** integrating OmniProject
with an organization's identity provider, n8n, and project backends.

For installation and day-to-day use, see the [README](../README.md). This
document covers architecture, the n8n integration contract, the security model,
the API surface, data schemas, and how to extend the system.

---

## 1. Architecture

OmniProject is a **stateless single pane of glass**. It stores no project data of
its own; every read and write is brokered through **n8n**, which talks to the
real backend(s) — Plane, OpenProject, Jira, Azure DevOps, ServiceNow, SAP,
Dynamics 365, or anything else n8n can reach.

```
 Browser            omni-shell container (port 3000)            n8n              Backends
┌───────────┐  /api  ┌──────────────────────────────┐  webhook ┌──────┐  REST/  ┌──────────────┐
│ SPA       │ ─────▶ │ Express gateway               │ ───────▶ │ n8n  │  OData  │ Plane / OP / │
│ React 19  │ ◀───── │  • OIDC relying party         │ ◀─────── │ flows│ ◀─────▶ │ Jira / SAP / │
│ (static)  │        │  • n8n proxy + idempotency    │ normalized│      │         │ Dynamics …   │
└───────────┘        │  • rate limit / audit         │  result  └──────┘         └──────────────┘
                     │  • serves the static SPA      │
                     └───────────────┬───────────────┘
                                     │ Authorization Code + PKCE
                                     ▼
                                 ┌────────┐
                                 │  IdP   │ Authentik (standalone) / BYO (Okta, Entra, Keycloak…)
                                 └────────┘
```

**Key properties**

- **Stateless shell.** The gateway keeps only a signed, httpOnly **session
  cookie** (wrapping the IdP-issued tokens). No database is required for the
  shell. The `lib/db` package is an unused scaffold; horizontal scaling needs
  only a shared session secret (`SESSION_SECRET`) across replicas.
- **Single container.** In production the Express gateway serves both `/api/*`
  and the built SPA (`STATIC_DIR`) on port `3000` — one image (`omni-shell`).
  In development the SPA runs under Vite and proxies `/api` to the gateway.
- **n8n is the only integration point.** Swapping or adding a backend is an n8n
  workflow change; the shell and gateway never change.

### Tech stack

| Layer | Choice |
| ----- | ------ |
| Frontend | Vite + React 19, wouter (routing), Zustand (UI state), TanStack Query, recharts |
| UI | Tailwind CSS v4, shadcn / Radix UI, cmdk, lucide-react |
| Gateway | Express 5, pino (structured logs + redaction), express-rate-limit |
| Contracts | OpenAPI 3.1 → Orval → React Query hooks + Zod schemas |
| Build | Vite (SPA), esbuild (gateway → self-contained bundle) |
| Tooling | pnpm workspaces, Node.js 22+, TypeScript 5.9 |

### Workspace layout

```
artifacts/
  omniproject/        # Vite + React SPA (the shell)
    src/pages/        # Home, Projects, ProjectDetail, Reports, Settings, Login
    src/components/    # board/ (AgileBoard, GanttChart), reports/, IssueDialog, ExportMenu, layout/
    src/lib/           # auth.ts (OIDC session client), ai.ts
    src/store/         # Zustand UI state
  api-server/         # Express gateway
    src/routes/        # health, auth, n8n-proxy, projects, portfolio, ai, export
    src/lib/           # n8n.ts, oidc.ts, settings.ts, data.ts, ai.ts, api-token.ts,
                       # rate-limit.ts, csv.ts, xlsx.ts, logger.ts
  n8n-blueprints/     # omniproject-core-sync.json (importable reference workflow)
lib/
  api-spec/           # openapi.yaml (source of truth) + Orval config
  api-zod/            # generated Zod schemas        ← do not hand-edit
  api-client-react/   # generated React Query hooks  ← do not hand-edit
  db/                 # Drizzle scaffold (unused)
scripts/              # verify-n8n-bidirectional.ts (contract test harness)
Dockerfile, docker-compose.*.yml, k8s-enterprise-manifest.yaml
```

---

## 2. Identity & access

### OIDC relying party

The gateway is a **relying party only** — it never stores passwords or mints its
own tokens. Flow: `GET /api/auth/login` → IdP (Authorization Code + PKCE) →
`GET /api/auth/callback` → the gateway stores a **signed, httpOnly session
cookie** wrapping the issued tokens.

- Configured when `OIDC_ISSUER_URL` + `OIDC_CLIENT_ID` + `OIDC_CLIENT_SECRET`
  are all set. Register the redirect URI `${PUBLIC_URL}/api/auth/callback` in
  your IdP.
- **Demo mode** (no OIDC vars): a local session is issued so the app runs
  without an IdP — for evaluation/local dev only.
- Protected API routes return `401` without a session; the SPA guard redirects
  to `/login`.

### Tenant isolation / anti-spoofing

Downstream calls run **as the active user**. The gateway:

1. Reads identity **only** from the validated session cookie — never from the
   request body or query string.
2. **Strips** any client-supplied `userContext`/`origin` from inbound payloads.
3. Injects a server-side context block into the outbound n8n payload:
   `payload.userContext = { sub, email, name, token }`.

n8n then authenticates to the backend with that per-user token
(`{{ $json.body.payload.userContext.token }}`), preserving per-user auditing
instead of a shared admin key.

> ⚠️ Because the user's access token travels in the request body to n8n, the
> gateway ↔ n8n hop **must be TLS** in production. Logs never capture bodies and
> token fields are redacted (see §5).

### Read-only API tokens (machine / BI clients)

Set `API_TOKENS` (comma-separated). A request presenting a valid token via
`Authorization: Bearer <token>` or `X-API-Key: <token>` is authenticated as a
**read-only** principal: `GET` only — any mutation returns `403`. This is how
Power BI and scheduled exporters pull data without an interactive login.
Generate tokens with `openssl rand -hex 32`.

---

## 3. The n8n integration contract

This is the core contract implementers build against. Everything the UI does
(except auth/health/settings, which are gateway-local) becomes one webhook call.

### Request

The gateway `POST`s to `N8N_WEBHOOK_URL` with:

```jsonc
// body
{
  "action": "create_issue",        // what to do
  "source": "all",                 // free-form backend routing hint
  "origin": "omniproject",         // who initiated the change (loop guard)
  "idempotencyKey": "<sha256 hex>",
  "payload": {
    "projectId": "…", "issueId": "…",
    "userContext": { "sub": "…", "email": "…", "name": "…", "token": "<oidc token>" }
    /* …action-specific fields… */
  }
}
```

```
// headers
X-OmniProject-Action: create_issue
X-OmniProject-Source: all
X-OmniProject-Origin: omniproject
X-OmniProject-Idempotency-Key: <sha256 hex>
Authorization: Bearer <session bearer>   (when available)
```

### Action catalog

| Action | Source header | Payload | Returns (`data`) |
| ------ | ------------- | ------- | ---------------- |
| `list_projects` | settings `backendSource` | — | `Project[]` |
| `list_issues` | settings `backendSource` | `{ projectId }` | `Issue[]` |
| `create_issue` | settings `backendSource` | `{ projectId, …IssueInput }` | `Issue` |
| `update_issue` | settings `backendSource` | `{ projectId, issueId, …IssueUpdate }` | `Issue` |
| `delete_issue` | settings `backendSource` | `{ projectId, issueId }` | — |
| `project_summary` | settings `backendSource` | `{ projectId }` | `ProjectSummary` |
| `list_activity` | settings `backendSource` | — | `ActivityEntry[]` |
| `get_resource_capacity` | `capacity_engine` | `{ projectId }` | `ResourceCapacity[]` |
| `get_project_financials` | `financial_ledger` | `{ projectId }` | `ProjectFinancials` |
| `get_portfolio_health` | `portfolio_master` | — | `PortfolioHealthSummary[]` |

Arbitrary actions can also be sent via `POST /api/n8n-proxy`.

### Response

n8n must return a normalized `N8nActionResult`, forwarded to the UI as-is:

```jsonc
{ "success": true, "data": { /* matches the schemas in §6 */ }, "message": "…" }
```

### Idempotency & loop guard

- **Idempotency key:** `sha256(action + projectId + issueId + timestamp_rounded_to_nearest_minute)`,
  sent in the body and the `X-OmniProject-Idempotency-Key` header. Identical
  actions on the same entity within a minute collapse to one key — use it to
  drop duplicate triggers.
- **Loop guard:** writes stamp `lastUpdatedBy = origin`. The blueprint's first
  node drops inbound events where `origin === lastUpdatedBy`, preventing
  circular Plane↔OpenProject (or any bi-directional sync) webhook storms.

### Reference workflow & dual routing

Import `artifacts/n8n-blueprints/omniproject-core-sync.json` (see its
[README](../artifacts/n8n-blueprints/README.md)). It provides switch routing for
every action and **dual OSS/enterprise mappings**:

| Action | Open-source mapping | Enterprise mapping |
| ------ | ------------------- | ------------------ |
| `get_resource_capacity` | TaskJuggler / worker tables | Dynamics 365 BC Jobs (`/api/v2.0/companies/jobs`) |
| `get_project_financials` | Dolibarr / Odoo CE | SAP S/4HANA Project API (OData) |
| `get_portfolio_health` | OpenProject PPM | SAP / Dynamics rollup |
| issues / projects | Plane / OpenProject REST | any REST/OData backend |

Set n8n env `PLANE_INSTANCE_URL` / `OPENPROJECT_INSTANCE_URL` (or your own).
Each variant **must** map its response to the §6 schema before `Respond`.

**Adding a backend:** no gateway change — add/replace the HTTP node(s) in the
n8n workflow and normalize to the contract. Point `backendSource` (free-form) at
a routing hint your workflow understands, or leave it `all`.

---

## 4. API surface

All under `/api`. Protected = requires a session **or** a read-only API token.

| Method & path | Auth | Notes |
| ------------- | ---- | ----- |
| `GET /api/healthz` | public | liveness/readiness probe |
| `GET /api/auth/login` · `/callback` · `POST /api/auth/logout` · `GET /api/auth/me` | public | OIDC flow + session |
| `POST /api/n8n-proxy` | session/token (GET-equivalent writes need session) | generic action passthrough |
| `GET /api/projects` | protected | `Project[]` |
| `GET /api/projects/{id}/issues` · `POST` | protected | list / create |
| `PATCH/DELETE /api/projects/{id}/issues/{issueId}` | session only (writes) | update / delete |
| `GET /api/projects/{id}/summary` | protected | `ProjectSummary` |
| `GET /api/activity` | protected | `ActivityEntry[]` |
| `GET /api/projects/{id}/capacity` | protected · **rate-limited** | `ResourceCapacity[]` |
| `GET /api/projects/{id}/financials` | protected · **rate-limited** | `ProjectFinancials` |
| `GET /api/portfolio/health` | protected · **rate-limited** | `PortfolioHealthSummary[]` |
| `GET /api/ai/status` · `POST /api/ai/chat` | protected | provider status / chat |
| `GET /api/export.xlsx` · `.csv` · `.json` · `.md` · `.pdf` | protected (token OK) | report export — workbook / CSV / JSON / Markdown / PDF (`?dataset=projects\|issues\|activity`). PDF + Markdown writers are dependency-free. |
| `GET/PATCH /api/settings` | protected | gateway-local config |

The full schema is `lib/api-spec/openapi.yaml`. Generated TanStack hooks and Zod
schemas live in `lib/api-client-react` / `lib/api-zod` (do not hand-edit).

---

## 5. Security & compliance

- **Rate limiting** (`express-rate-limit`): a general ceiling on `/api/*` plus a
  **strict 30 requests / 15 min** window on the analytics endpoints
  (`portfolio/health`, `*/financials`, `*/capacity`) — `429 { error }` JSON when
  exceeded. Keyed by session `sub`, else client IP. Health probes are exempt.
- **Audit trail:** every proxied operation emits one structured pino line —
  `{ audit: true, action, projectId, sub, idempotencyKey, origin, msg: "proxy_operation" }`
  with a timestamp — to stdout (ship to your log pipeline).
- **Redaction:** pino redacts `authorization` / `cookie` headers, `set-cookie`,
  and any `token` / `*.token` / `userContext.token` fields. Tokens never appear
  in logs (verified by the contract test).
- **Idempotency:** see §3 — protects n8n and downstream APIs from duplicate
  triggers and edit races.
- **Transport:** terminate TLS at the ingress/proxy; the gateway honours
  `X-Forwarded-*` (`trust proxy`). The gateway↔n8n hop must be TLS (user token in
  body).
- **Supply chain:** `pnpm-workspace.yaml` enforces a `minimumReleaseAge` of 1
  day on dependencies; CSV/XLSX export is implemented dependency-free.

---

## 6. Data schemas

Canonical definitions are in `openapi.yaml`. Summary:

- **Project** — `id, name, identifier, description?, source, issueCount, completedCount, memberCount, updatedAt`.
- **Issue** — `id, projectId, title, description?, status, priority, assignee?, labels[], startDate?, dueDate?, source, lastUpdatedBy?, createdAt, updatedAt`.
  - `status`: `backlog | todo | in_progress | in_review | done | cancelled`
  - `priority`: `none | urgent | high | medium | low`
- **ProjectSummary** — `projectId, total, byStatus{}, byPriority{}, completionRate, overdue`.
- **ActivityEntry** — `id, action, actor, projectId, issueId?, issueTitle?, detail?, timestamp`.
- **ResourceCapacity** — `resourceId, resourceName, role, allocationPercentage, assignedHours, availableHours, utilizationState` (`OVER_ALLOCATED | OPTIMAL | UNDER_ALLOCATED`).
- **ProjectFinancials (EVM)** — `currency, budgetAllocated, actualBurn, earnedValue, cpi, spi, financialHealth` (`GREEN | AMBER | RED`)`, forecastCostAtCompletion`.
  - CPI = EV / AC, SPI = EV / PV. `financialHealth` is a derived RAG.
- **PortfolioHealthSummary** — `projectId, projectName, ragStatus` (`GREEN | AMBER | RED`)`, scheduleVarianceDays, budgetVariancePercentage, activeBlockersCount`.

> n8n is responsible for **computing/normalizing** these (e.g. EVM math, RAG
> rollups) from the backend before returning them.

---

## 7. Build & release

- **Contract-first:** edit `lib/api-spec/openapi.yaml`, then
  `pnpm --filter @workspace/api-spec run codegen` to regenerate Zod + hooks.
  Never hand-edit generated folders.
- **SPA:** `vite build` (requires `PORT` + `BASE_PATH` at config-eval time).
- **Gateway:** esbuild produces a self-contained `dist/index.mjs` (+ pino worker
  sidecar files — ship the whole `dist/`).
- **Image:** the multi-stage `Dockerfile` builds both and runs the gateway with
  `STATIC_DIR` set, serving SPA + API on port 3000.
- **Contract test:** `scripts/src/verify-n8n-bidirectional.ts` mocks n8n and
  asserts the full contract (auth gate, idempotency/origin/userContext headers,
  data shapes, AI status, exports). Run via `verify-n8n` (see README).

---

## 8. Extending the system

**Add an endpoint (end to end):**

1. Define the path + schema in `openapi.yaml`; run codegen.
2. Add an Express route in `artifacts/api-server/src/routes/` that calls
   `callN8n(action, payload, { authHeader, source, userContext })` (with a demo
   fallback if you want it to run without n8n).
3. Add an n8n switch branch for the new `action`, normalize to your schema.
4. Consume the generated TanStack hook in the SPA.

**Add an n8n action only:** steps 2–4 without a schema change (use
`POST /api/n8n-proxy`).

---

## Internationalization & multi-currency

- **i18n** is dependency-free (`src/lib/i18n.tsx`): an `I18nProvider` + `useT()`
  hook, a per-key dictionary (en/fr/de/es; English is the fallback), and
  `Intl`-based number/date/currency formatting driven by the active locale. The
  locale is auto-detected (browser → `omni.locale`) and switchable from the
  header. Add a locale by extending `LOCALES` + `TRANSLATIONS`; add a string by
  adding a key to each locale.
- **Multi-currency**: financials are read in each backend's native currency and
  formatted locale-aware. FX rates are read-through via n8n (`get_fx_rates`,
  source `fx_provider`; demo rates as fallback) at `GET /api/fx-rates`; the
  Earned-Value report has a **display-currency** selector that converts via
  `convertAmount()` (base-anchored, unit-tested). No rates are stored.

## Action audit logging

Consistent with statelessness, OmniProject does **not retain logs** — it **emits**
a structured audit event per action and (optionally) **ships them to your logging
server**. Scope is configurable: full logging of all actions, or a subset.

- `AUDIT_LEVEL` = `off` | `writes` | `all` (default `writes`):
  - `off` — disabled; `writes` — mutations + auth + admin/config + brokered
    writes; `all` — every request (incl. reads) + every brokered action.
- Every event is one structured line on stdout (pino, with token/cookie
  redaction): `{ ts, category, action, actor{sub,email,role}, status, ms, ip,
  write, … }`. `category` ∈ request | auth | broker | admin.
- **External logging server**: set `AUDIT_HTTP_URL` (+ optional
  `AUDIT_HTTP_TOKEN`) to POST batched **NDJSON** to Loki / Splunk HEC / Elastic /
  a syslog-over-HTTP collector. Delivery is batched (`AUDIT_BATCH`, `AUDIT_FLUSH_MS`),
  best-effort and **in-memory** (bounded buffer, no disk) — for guaranteed
  retention point it at a durable collector. Syslog-only shops can instead ship
  stdout via their log agent (12-factor).

Setup → *Status* shows the active level + whether a sink is configured.

**Brokered n8n actions log their outcome.** Each `category: "broker"` event is
recorded *after* the call with `result` (success/error), upstream `status` and
`ms`, plus the `actor` (sub/email/role) — so logs answer "who ran which n8n
action, when, and did it succeed?". Example:
`{"category":"broker","action":"create_issue","actor":{"sub":"…","role":"admin"},"result":"success","status":200,"ms":54}`.

## Stateful developer mode

Demo mode is in-memory and resets on restart. Set `DEV_PERSIST_FILE=<path>` and
the demo dataset (projects/issues/RAID) is **saved on every mutation and reloaded
on boot**, so developers can build up test scenarios that survive restarts
without wiring n8n. Dev/test only — it's a no-op when `N8N_WEBHOOK_URL` is set
(production serves real data through n8n). Setup → *Status* shows whether it's on.

## Environments & rollback (config change management)

OmniProject versions its own **configuration** (never project data) so changes
are safe and reversible — Setup → *Environments & rollback*, or the API:

- **Environments** — named config profiles (default `production`; create
  `sandbox`). Design/test integration config in a sandbox **without touching
  production**, then **promote** sandbox → production. Switching the active
  environment applies that profile's config to the live settings.
- **Versioned rollback** — every settings change is recorded as a version. Pin a
  version as **known-good**; if production breaks, roll back instantly to that
  version (or any earlier one). Latest known-good is one click / one call.
- **Durability** — in-memory by default (single replica). Set `CONFIG_STORE_FILE`
  to persist environments + history across restarts, so rollback survives a
  crash. History is capped (last 100 versions).

| Action | Endpoint (admin) |
| ------ | ---------------- |
| List environments + history | `GET /api/setup/environments` |
| Create environment | `POST /api/setup/environments {name}` |
| Switch active environment | `POST /api/setup/environments/activate {name}` |
| Promote one env onto another | `POST /api/setup/promote {from,to}` |
| Pin a version known-good | `POST /api/setup/versions/{id}/known-good` |
| Roll back | `POST /api/setup/rollback {versionId? , toKnownGood?}` |

> For fully parallel prod + sandbox **runtime**, run a second instance pointed at
> the sandbox environment (or its snapshot export). The single-instance profile
> model covers the design → test → promote → rollback workflow.

## Testing & scale

CI runs (in order): typecheck → gateway unit tests → codegen-drift → builds →
n8n contract verification → **E2E smoke + stress** → env-gated integration cert.

| Harness | Command | What it does |
| ------- | ------- | ------------ |
| Unit | `pnpm --filter @workspace/api-server test` | 49 `node:test` cases — pure gateway logic (JWKS, RBAC, concurrency, currency, snapshot, mapping certification…). |
| Contract | `pnpm --filter @workspace/scripts run verify-n8n` | 98 assertions over the live gateway + a mock n8n. |
| **E2E smoke** | `pnpm --filter @workspace/scripts run e2e-smoke` | Single-container check: SPA shell is served + the critical journey (login → projects → issues → summary → capabilities → reports) responds. |
| **Stress** | `pnpm --filter @workspace/scripts run stress` | Load test — `STRESS_USERS` (2000) × `STRESS_REQS` (3) at `STRESS_CONCURRENCY` (100); reports throughput + p50/p95/p99, fails over `STRESS_MAX_ERROR_RATE`. |
| **Live cert** | `pnpm --filter @workspace/scripts run integration:openproject` | Certifies the OpenProject mapping against a real instance when `OPENPROJECT_LIVE_URL` + `OPENPROJECT_TOKEN` are set; SKIPS otherwise. |

Scale knobs (env):

- `DEMO_SCALE_PROJECTS=200` (+ `DEMO_SCALE_ISSUES=10`) — synthesise a large demo
  portfolio for load/e2e testing without a backend.
- `API_RATE_LIMIT_MAX` / `ANALYTICS_RATE_LIMIT_MAX` — tune the per-15-min ceilings
  for high-concurrency deployments; `RATE_LIMIT_DISABLED=true` bypasses entirely
  (behind an external gateway/WAF, or for a stress run).

Reference run (single demo replica, GitHub-hosted runner): **6000 requests,
0 errors, ~1800 req/s, p95 ≈ 90 ms** for 2000 virtual users over 200 projects.

## See also

- [README](../README.md) — install, deploy, and use.
- [AGENTS.md](../AGENTS.md) — contributor/agent notes and gotchas.
- [n8n blueprint README](../artifacts/n8n-blueprints/README.md) — import & wiring.
