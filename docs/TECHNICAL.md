# OmniProject — Technical Reference

Audience: **IT, platform engineers, and implementers** integrating OmniProject
with an organization's identity provider, the broker (n8n by default), and
project backends.

For installation and day-to-day use, see the [README](../README.md). This
document covers architecture, the n8n integration contract, the security model,
the API surface, data schemas, and how to extend the system.

---

## 1. Architecture

OmniProject is a **read-through overlay with no database of its own**. It stores
no project data; every read and write is brokered to the real backend(s) — Plane,
OpenProject, Jira, Azure DevOps, ServiceNow, SAP S/4HANA, Oracle Fusion Cloud ERP,
NetSuite, Dynamics 365 (Project Operations and Finance & Operations), or anything
else the broker can reach. Because nothing is copied, the backend stays the single
source of truth and there is no cached state to fall out of sync — the UI is a
*view*, never a fork of your data.

Internally the gateway talks to a **`Broker` interface** in its own domain
vocabulary, never to a backend directly. **n8n is the reference implementation**
of that interface; a first-party **built-in broker** (opt-in via `BUILTIN_BROKER`,
over a pluggable memory/Postgres store) is a real, non-dev adapter selected when
no `BROKER_URL` and no dev broker are set; `DemoBroker` is a third, in-process one
that proves the seam is generic (it serves the whole app from sample data, no
backend). All
n8n specifics are confined to one adapter module behind the seam, and an
architecture-guard test fails CI if any n8n-ism leaks above it — so "swap the
broker if n8n is superseded" is a property the build enforces, not just an
intention. See [BROKER.md](BROKER.md). The n8n contract documented in §3 is the
**ReferenceBroker's** contract, under the seam.

The `Broker` interface itself is **published as a versioned contract**:
[CONTRACT.md](CONTRACT.md) plus a machine-readable
[JSON Schema](contract/broker.v1.schema.json), both generated from
`src/broker/{types,contract}.ts` in CI (so they can't drift) and served live at
`GET /api/contract`. A broker-agnostic conformance suite
(`src/broker/conformance.ts`) certifies any adapter against it — DemoBroker is
the reference pass, the live n8n run the real-world pass.

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
  shell — there is no first-party ORM/DB package (an earlier empty scaffold was
  removed); horizontal scaling needs only a shared session secret
  (`SESSION_SECRET`) across replicas.
- **Single container.** In production the Express gateway serves both `/api/*`
  and the built SPA (`STATIC_DIR`) on port `3000` — one image (`omni-shell`).
  In development the SPA runs under Vite and proxies `/api` to the gateway.
- **The broker is the only integration point.** With the reference broker (n8n),
  swapping or adding a backend is a workflow change; the shell and gateway never
  change.

### Tech stack

| Layer | Choice |
| ----- | ------ |
| Frontend | Vite + React 19, wouter (routing), Zustand (UI state), TanStack Query, recharts |
| UI | Tailwind CSS v4, shadcn / Radix UI, cmdk, lucide-react |
| Gateway | Express 5, pino (structured logs + redaction), express-rate-limit |
| Contracts | OpenAPI 3.1 → Orval → React Query hooks + Zod schemas |
| Build | Vite (SPA), esbuild (gateway → self-contained bundle) |
| Tooling | pnpm workspaces, Node.js 26, TypeScript 6.0 |

### Workspace layout

```
artifacts/
  omniproject/        # Vite + React SPA (the shell)
    src/pages/        # Home, Projects, ProjectDetail, Reports, Settings, Login
    src/components/    # board/ (AgileBoard, GanttChart), reports/, IssueDialog, ExportMenu, layout/
    src/lib/           # auth.ts (OIDC session client), ai.ts
    src/store/         # Zustand UI state
  api-server/         # Express gateway
    src/routes/        # health, auth, broker-command, projects, portfolio, ai, export
    src/broker/        # the Broker seam — types.ts, index.ts, reference-broker/ (the only
                       # broker-aware code), demo.ts (see docs/BROKER.md)
    src/lib/           # oidc.ts, settings.ts, data.ts (broker facade), ai.ts,
                       # api-token.ts, rate-limit.ts, csv.ts, xlsx.ts, logger.ts
  n8n-blueprints/     # omniproject-core-sync.json (importable reference workflow)
lib/
  api-spec/           # openapi.yaml (source of truth) + Orval config
  api-zod/            # generated Zod schemas        ← do not hand-edit
  api-client-react/   # generated React Query hooks  ← do not hand-edit
scripts/              # verify-broker-contract.ts (contract test harness)
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

#### SAML 2.0 (optional, alongside OIDC)

For IdPs/procurement that mandate SAML, the gateway also runs as a SAML **Service
Provider**. SP-initiated flow: `GET /api/auth/saml/login` → IdP → the IdP POSTs a
signed assertion to the ACS `POST /api/auth/saml/callback` → the same signed,
httpOnly session cookie is issued. The assertion's group attributes feed the **same
role-map** as OIDC claims (lib/rbac + the role-map editor), so group→role assignment
is identical across both protocols.

- **Optional, install-on-demand dependency.** The SAML library `@node-saml/node-saml`
  is *not* a declared dependency — a default install and the CI install never pull it,
  so OIDC/demo/charity deployments carry zero extra weight (mirrors the optional Redis
  rate-limit store). Enable with:
  `pnpm --filter @workspace/api-server add @node-saml/node-saml`. If SAML is configured
  but the package is absent, the gateway logs a one-time warning and SAML stays
  unavailable — OIDC/demo keep working and it never crashes.
- **Configured when** `SAML_IDP_ENTRY_POINT` + `SAML_IDP_CERT` (PEM or base64-of-PEM)
  + an ACS callback URL (`SAML_CALLBACK_URL`, or derived from `PUBLIC_URL`) are set.
  Optional: `SAML_SP_ENTITY_ID`, `SAML_AUDIENCE`, `SAML_EMAIL_ATTR`/`SAML_NAME_ATTR`/
  `SAML_GROUPS_ATTR` (default `email`/`displayName`/`groups`; set to your IdP's URNs),
  `SAML_WANT_RESPONSE_SIGNED`. SP metadata for the IdP is at
  `GET /api/auth/saml/metadata`. Assertions are always required signed.
- **Honest scope:** SAML asserts identity and drives RBAC but does not mint a per-user
  backend bearer; brokered writes then use the broker's own credentials (like demo).
  Use OIDC where per-user backend tokens are required.

### Tenant isolation / anti-spoofing

Downstream calls run **as the active user**. The gateway:

1. Reads identity **only** from the validated session cookie — never from the
   request body or query string.
2. **Strips** any client-supplied `userContext`/`origin` from inbound payloads.
3. Injects a server-side context block into the outbound broker payload:
   `payload.userContext = { sub, email, name, token }`.

The broker then authenticates to the backend with that per-user token
(in the reference broker, `{{ $json.body.payload.userContext.token }}`),
preserving per-user auditing instead of a shared admin key.

> ⚠️ Because the user's access token travels in the request body to the broker,
> the gateway ↔ broker hop **must be TLS** in production. Logs never capture
> bodies and token fields are redacted (see §5).

### Read-only API tokens (machine / BI clients)

Set `API_TOKENS` (comma-separated). A request presenting a valid token via
`Authorization: Bearer <token>` or `X-API-Key: <token>` is authenticated as a
**read-only** principal: `GET` only — any mutation returns `403`. This is how
Power BI and scheduled exporters pull data without an interactive login.
Generate tokens with `openssl rand -hex 32`.

---

## 3. The n8n integration contract

> This is the **ReferenceBroker's** wire contract — the webhook envelope, headers and
> action catalogue live *inside the adapter* (`src/broker/reference-broker/index.ts`), under the
> `Broker` seam (§1, [BROKER.md](BROKER.md)). Nothing above the seam sees any of
> it. It is documented here because n8n is the implementation operators wire up.

This is the core contract implementers build against. Everything the UI does
(except auth/health/settings, which are gateway-local) becomes one webhook call.

### Request

The gateway `POST`s to `BROKER_URL` with:

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

Arbitrary actions can also be sent via `POST /api/broker/command`.

### Response

The broker must return a normalized `BrokerEnvelope`, forwarded to the UI as-is:

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

### Scaling the broker — pooling & load balancing

A single broker endpoint doesn't have to be a single point of failure or a
throughput ceiling. Two independent mechanisms, usable together:

- **A flat pool** — set `BROKER_URLS` to a comma-separated list of webhook URLs
  (instead of the single `BROKER_URL`). Every call round-robins across the pool
  and, on a connection-level failure (timeout, DNS, connection refused —
  never a real HTTP response from the broker), retries the next endpoint in
  rotation. This is for running several instances of the *same* broker (e.g.
  n8n behind a load balancer, or several n8n workers) for throughput and
  redundancy.
- **Per-kind routed pools** — `BROKER_ENDPOINTS` takes `kind=url1|url2,kind2=url3`
  so different broker *kinds* (or different backend groupings, e.g. one region's
  n8n vs another's — see [docs/DATA-RESIDENCY.md](DATA-RESIDENCY.md)) each get
  their own pool, resolved per-call via the router (`artifacts/api-server/src/
  broker/router.ts`, an `AsyncLocalStorage`-scoped endpoint context) rather than
  one global default. This is what lets one deployment read from several
  *different* systems concurrently while each still gets its own failover pool.

Implementation: `webhookPool()` / `resolvePool()` / `orderedTargets()` in
`artifacts/api-server/src/broker/reference-broker/index.ts`. See
[docs/BROKER-HTTP-BINDING.md](BROKER-HTTP-BINDING.md) for the exact env syntax.

---

## 4. API surface

All under `/api`. Protected = requires a session **or** a read-only API token.

| Method & path | Auth | Notes |
| ------------- | ---- | ----- |
| `GET /api/healthz` | public | liveness/readiness probe |
| `GET /api/auth/login` · `/callback` · `POST /api/auth/logout` · `GET /api/auth/me` | public | OIDC flow + session |
| `POST /api/broker/command` | session/token (GET-equivalent writes need session) | generic broker command passthrough |
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
- **Idempotency:** see §3 — protects the broker and downstream APIs from
  duplicate triggers and edit races.
- **Transport:** terminate TLS at the ingress/proxy; the gateway honours
  `X-Forwarded-*` (`trust proxy`). The gateway↔broker hop must be TLS (user token
  in body).
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

> The broker is responsible for **computing/normalizing** these (e.g. EVM math,
> RAG rollups) from the backend before returning them.

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
- **Contract test:** `scripts/src/verify-broker-contract.ts` mocks n8n and
  asserts the full contract (auth gate, idempotency/origin/userContext headers,
  data shapes, AI status, exports). Run via `verify-broker` (see README).

---

## 8. Extending the system

**Add an endpoint (end to end):** route handlers only ever talk to the `Broker`
interface (`getBroker()`), never to n8n directly — see [BROKER.md](BROKER.md).

1. Define the path + schema in `openapi.yaml`; run codegen.
2. Add the operation to the `Broker` interface in `src/broker/types.ts` (domain
   vocabulary — no action strings).
3. Implement it in **both** adapters: `ReferenceBroker` (`src/broker/reference-broker/index.ts`) maps it to
   an n8n action + normalizes the response; `DemoBroker` (`src/broker/demo.ts`)
   returns canned data so it runs offline.
4. Add an Express route in `artifacts/api-server/src/routes/` that calls
   `getBroker().<method>(contextFromReq(req), …)`.
5. Consume the generated TanStack hook in the SPA.

**One-off command (no schema change):** use the generic `command()` method /
`POST /api/broker/command` — it carries an arbitrary command name through the
broker without adding an interface method.

---

## Internationalization & multi-currency

- **i18n** is dependency-free (`src/lib/i18n.tsx`): an `I18nProvider` + `useT()`
  hook, a per-key dictionary (en/fr/de/es; English is the fallback), and
  `Intl`-based number/date/currency formatting driven by the active locale. The
  locale is auto-detected (browser → `omni.locale`) and switchable from the
  header. Add a locale by extending `LOCALES` + `TRANSLATIONS`; add a string by
  adding a key to each locale.
- **Multi-currency**: financials are read in each backend's native currency and
  formatted locale-aware. FX rates are read-through via the broker (`get_fx_rates`,
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

**Brokered actions log their outcome.** Each `category: "broker"` event is
recorded *after* the call with `result` (success/error), upstream `status` and
`ms`, plus the `actor` (sub/email/role) — so logs answer "who ran which broker
action, when, and did it succeed?". Example:
`{"category":"broker","action":"create_issue","actor":{"sub":"…","role":"admin"},"result":"success","status":200,"ms":54}`.

## Stateful developer mode

Demo mode is in-memory and resets on restart. Set `DEV_PERSIST_FILE=<path>` and
the demo dataset (projects/issues/RAID) is **saved on every mutation and reloaded
on boot**, so developers can build up test scenarios that survive restarts
without wiring a backend. Dev/test only — it's a no-op when `BROKER_URL` is set
(production serves real data through the broker). Setup → *Status* shows whether
it's on.

**Production is stateless — stateful mode is refused there.** If `DEV_PERSIST_FILE`
is set with `NODE_ENV=production` it is **ignored with a warning** (it would break a
stateless deployment). It is never a UI toggle, so end users can't enable it. In
dev mode, admins can download a **debug bundle** (`GET /api/setup/debug-bundle`):
a `.zip` of `config.json` + `demo-state.json` for reproducible bug reports and
sharing on GitHub.

## BI & observability integrations

Beyond file exports, OmniProject exposes pull endpoints for BI and monitoring
tools (all GET, usable with a read-only `API_TOKENS` bearer — no interactive
login):

| Endpoint | For | Notes |
| -------- | --- | ----- |
| `GET /api/metrics` | **Grafana** (via Prometheus) | Prometheus exposition (text 0.0.4): `omniproject_projects_total`, `omniproject_issues_total`, `omniproject_issues_completed_total`, `omniproject_portfolio_rag{status}`, per-project gauges. Scrape with the API token as a Bearer. Stateless — computed per request. |
| `GET /api/odata/` (+ `/$metadata`, `/Projects`, `/Issues`, `/Programmes`) | **SAP / Dynamics / Oracle / Power BI** | OData v4 read service — the native feed format big ERPs + Power BI ingest. Supports `$select` / `$top` / `$skip` / `$orderby` / `$count` and a minimal `$filter` (`eq`, `contains`). Point the OData connector at `/api/odata/` with a read-only token. |
| `GET /api/bi/feeds` | **Power BI / Excel / Sheets** | A manifest of JSON/XLSX/OData feed URLs to plug into the Web/OData connector. |
| `GET /api/export.json\|csv\|xlsx` | Power BI, warehouses | Per-dataset feeds (`?dataset=projects\|issues\|activity`). |
| `GET /api/portfolio/health` | dashboards | Portfolio RAG / variance JSON. |

**Roadmap** (not yet built): **Power BI incremental refresh** (OData delta
tokens); a **Grafana JSON-API datasource** endpoint (query/annotations); and an
**iCal** feed for deadlines/milestones. Outbound **webhook push** is now built —
see *Premium overlay* below.

## Premium overlay (licensed features)

Three overlay features are gated behind a **time-limited, signed licence key** —
the paywall. OmniProject stays stateless: entitlements are not a billing
database, they are carried by `LICENSE_KEY` (config/env). The key is an
**Ed25519-signed** token issued by the vendor and verified in the deployment
against the vendor's public key (`LICENSE_PUBLIC_KEY`). It cannot be forged or
extended without the private key, and stops granting features once `exp` passes —
at which point the premium features **revert to their free defaults
automatically**.

> **Pre-community period:** enforcement is **dormant** — `resolveLicense()` grants
> every feature by default, so the paywall and the 402s described below do not
> apply unless `PREMIUM_ENFORCEMENT=on`. The signing/verification machinery stays
> intact; this section documents the enforced model that returns later. See
> [LICENSING.md](../LICENSING.md).

| Feature | What it unlocks | Endpoints |
| ------- | --------------- | --------- |
| `branding` | **White-label** the UI: app name, short badge, logo, accent colour, login heading + footer. The login screen is branded pre-auth. | `GET /api/branding` (public), `PUT`/`DELETE /api/branding` (admin) |
| `labels` | **Company nomenclature** — override UI terms ("Projects" → "Engagements", "Programmes" → "Portfolios") from a curated catalogue; layered over i18n so it wins in every locale. | `GET /api/labels` (public), `PUT /api/labels` (admin) |
| `webhooks` | **Outbound push** — fan events (`notification`, `audit`, `config.changed`) to a customer endpoint, SIEM, Slack, or an n8n webhook node. Each delivery is HMAC-SHA256 signed (`X-OmniProject-Signature`). Fire-and-forget (stateless); for at-least-once, target an n8n webhook and let n8n queue retries. | `GET`/`POST /api/webhooks`, `DELETE /api/webhooks/:id`, `POST /api/webhooks/:id/test` (all admin) |
| `enterprise_workflows` | **Enterprise backend integrations** — generate importable n8n workflows for the large ERPs / scheduling systems (SAP S/4HANA, SAP S/4HANA financials, Oracle Primavera, Oracle Fusion Cloud ERP, NetSuite, Dynamics 365 Project Operations, Dynamics 365 Finance & Operations, MS Project, generic enterprise template). Standard backends (Jira, OpenProject, GitHub, ServiceNow, …) stay free. | `POST /api/setup/generate-workflow` (admin) returns 402 for an enterprise backend without the feature |

Write paths return **402 Payment Required** when the feature isn't licensed
(under enforcement; dormant in the pre-community period — all features are free
by default). `GET /api/license` (and `setup/status.licensing`) report the current tier,
entitled features and expiry, so the UI shows locked/unlocked states. Branding +
label overrides are stored in the settings store and **included in config
snapshots** (no secrets); webhook subscriptions carry signing secrets and are
**configured per-environment** (`WEBHOOKS` env or the admin UI), excluded from
snapshots.

The vendor-side lifecycle — generate an offline issuing keypair, then mint a signed,
time-limited `LICENSE_KEY` per customer — is driven by `scripts/src/mint-license.ts`; the
full keygen/mint workflow and the open-core model live in [LICENSING.md](../LICENSING.md).

Config env: `BRAND_APP_NAME`, `BRAND_SHORT_NAME`, `BRAND_LOGO_URL`,
`BRAND_PRIMARY_COLOR`, `BRAND_LOGIN_HEADING`, `BRAND_FOOTER_TEXT`,
`BRAND_SUPPORT_URL` seed branding; `LABEL_OVERRIDES` (JSON) seeds nomenclature;
`WEBHOOKS` (JSON array of `{url, secret, events}`) seeds subscriptions. In
non-production, `LICENSE_DEV_FEATURES=all` unlocks premium for development
(ignored in production).

> **Automated sales fulfilment** (payment-provider checkout → automatic minting) was removed
> for the pre-community period — premium is free to run, so there's no storefront code in the
> runtime; licences are minted directly with `mint-license.ts`. See [LICENSING.md](../LICENSING.md).

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
| Unit | `pnpm --filter @workspace/api-server test` | 86 `node:test` cases — pure gateway logic (JWKS, RBAC, concurrency, currency, snapshot, licensing, branding/labels, webhooks, mapping certification…). |
| Contract | `pnpm --filter @workspace/scripts run verify-broker` | 137+ assertions over the live gateway + a mock n8n (the premium suite adapts to the licensed/unlicensed state). |
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

**Human-auditability set** (read these to understand the whole system in one sitting):

- [ARCHITECTURE.md](ARCHITECTURE.md) — the system overview: stateless/zero-at-rest
  model, the layer cake, the broker seam, the security spine, dev-mode gating
  (Mermaid diagrams).
- [SEQUENCES.md](SEQUENCES.md) — seven traced sequence walkthroughs (auth, broker
  read, optimistic-concurrency write, capability resolution, snapshot sign/verify,
  notification dispatch, dev-mode gating).
- [READING-GUIDE.md](READING-GUIDE.md) — subsystem → entry-point-file map + glossary.
- [FUNCTION-MAP.md](FUNCTION-MAP.md) — the generated per-function index.
- [DOCUMENTATION-INDEX.md](DOCUMENTATION-INDEX.md) — every other doc under `docs/`,
  mapped by purpose (security & compliance, operations & scale, product & buyer,
  audit findings).

**Other references:**

- [README](../README.md) — install, deploy, and use.
- [AGENTS.md](../AGENTS.md) — contributor/agent notes and gotchas.
- [n8n blueprint README](../artifacts/n8n-blueprints/README.md) — import & wiring.
