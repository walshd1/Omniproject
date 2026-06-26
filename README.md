# OmniProject

> **A read-through overlay for programme & project management — with finance,
> time and resource tracking — and no database of its own.**
> Your existing tools stay the single source of truth; OmniProject is just a
> different view onto them. It **fits the stack you already have** — from the whole
> thing on a single Docker host, to Kubernetes, in front of anything from a team's
> Jira to an enterprise's SAP — and reaches them through one **swappable broker
> seam** defined by a [published contract](docs/CONTRACT.md). OmniProject is
> **broker-agnostic by design, with n8n as the reference broker**; **if you run
> something else, you implement the contract and it copes.**

Most "single pane of glass" tools quietly become a *second* place your data
lives: they copy issues into their own store, and then you spend your life
fixing sync drift. **OmniProject stores nothing.** Every read and write is
brokered live — through the reference broker, n8n, by default — to the systems
that already own your data (Jira, OpenProject, ServiceNow, SAP, … as
illustrative examples, not a fixed list). There is no copy, so there is nothing
to fall out of sync — the backend is always right, and OmniProject just renders it.

**Why no database is the feature, not a gap:**

- **Nothing can get out of sync** — there's no cached copy to drift. What you see
  is the backend, right now.
- **One source of truth, many views** — programme rollup, portfolio RAG, a single
  project board — all are *views*, never a fork of your data.
- **Not another data store to secure or comply with** — no project data at rest in
  OmniProject means a far smaller blast radius and an easy answer for data-
  residency / audit reviews.
- **Swap or add backends without migrating** — anything n8n can reach can be
  federated underneath; the UI never changes.

**It's not another system to adopt — it's a layer that fits the workflow you
already have.** Your tools, your broker, your SSO stay exactly where they are;
OmniProject plugs into them and surfaces *what you need, when you need it*. It
**runs wherever you do** — the entire stack on one Docker host for a small team,
or scaled out to **Kubernetes** in front of enterprise systems like **SAP** — and
because everything below the broker seam is pluggable, **if your broker isn't n8n
it adapts rather than breaks.** Nobody has to move into a new app, migrate data,
or change how they work.

**And it speaks the methodology you already run.** The data model is
methodology-neutral, so the same backend renders as a **Kanban** board, a
**Scrum** sprint (backlog, burndown, velocity), a **Gantt / Waterfall** timeline,
**PRINCE2** management stages with a highlight report, a **RAID** log, or a plain
**list** — switch per team or per project without re-shaping anything underneath.
**Run a methodology we don't ship?** The view layer is **open and documented** —
a new view is a small component you can add yourself for free, or have us build as
a service. There's **no black-boxed "view designer"** to buy (and none to need):
see [docs/METHODOLOGIES.md](docs/METHODOLOGIES.md).

**It's programme management, not just a task board.** Above the issue level it
gives you a real delivery picture — read through from your backends, and shown
only where a backend actually supplies it:

- **Programmes** — roll many projects into a programme-wide view with portfolio
  RAG/health, then drill into a single project. Programmes are optional and
  derived, not a structure you have to maintain.
- **Finance** — Earned Value (CPI/SPI), budget vs actuals, and **multi-currency**
  (each backend reports its own currency; convert to one display currency).
- **Time & schedule** — time-phased Gantt, milestones, today/overdue markers.
- **Resources** — capacity and allocation, assigned-vs-available hours, and
  over/under-allocation alerts.

It's a brutalist, keyboard-driven shell that slots in *alongside* what an
organization already runs, instead of asking them to move into it.

```
┌─────────────┐     /api/*      ┌──────────────┐   contract    ┌──────────────┐    ┌──────────────┐
│  SPA (Vite) │ ───────────────▶│  Gateway     │ ─────────────▶│   broker     │───▶│ your backends │
│  React 19   │◀─────────────── │  (Express)   │◀───────────── │ (n8n default)│    │ Jira / OP /   │
└─────────────┘   normalized    └──────┬───────┘   normalized  └──────────────┘    │ ServiceNow /  │
   (a view, not a copy)                │  OIDC (Authorization Code + PKCE)         │ SAP …         │
                                       ▼                          ▲               └──────────────┘
                                  ┌──────────┐         docs/CONTRACT.md       (the single source of truth)
                                  │   IdP    │  Authentik (standalone) / BYO-SSO (enterprise)
                                  └──────────┘
```

### Broker-agnostic by design (not locked to n8n)

OmniProject talks to a single **`Broker` interface** in its own domain
vocabulary — and **above that seam the codebase is structurally incapable of
knowing the broker is n8n.** Every route, report, exporter, and the entire SPA
speak only that interface; none of them name, import, or assume n8n.

- **DemoBroker proves the seam is generic.** A second, in-process broker
  (`DemoBroker`) ships alongside n8n and serves the entire app from sample data
  with no backend at all — concrete proof that "above the seam knows nothing of
  n8n" is real, not aspirational. n8n is the **reference broker** that ships for
  production; if you ever replace or supplement it, you implement **one class**
  against the published contract and *nothing above the seam moves* — the UI, the
  API surface, and the data model are untouched.
- **The boundary is enforced, not aspirational.** A CI **architecture-guard**
  fails the build if any n8n-ism leaks across the seam, and a broker-agnostic
  **conformance suite** is the contract any adapter must pass — DemoBroker is the
  reference pass, the live n8n run is the real-world pass. So "swappable" is a
  property the tests keep true, not a promise in a README. See
  [docs/BROKER.md](docs/BROKER.md).
- **The contract is published, versioned and generated from the code.** The full
  request/response shapes, response envelope + provenance, control semantics
  (dry-run, optimistic concurrency, idempotency, origin loop-guard) and the
  webhook ingest/emit shapes live in **[docs/CONTRACT.md](docs/CONTRACT.md)** with
  a machine-readable [JSON Schema](docs/contract/broker.v1.schema.json) — both
  generated from `broker/{types,contract}.ts` in CI so they can't drift, and also
  served live at `GET /api/contract`.
- **Why n8n earns the default slot:** one workflow per backend, no hand-rolled
  connectors to rot, and the user's own token forwarded so writes happen *as them*
  (real per-user audit in the backend, not a shared admin key).

In short: OmniProject is **tool-agnostic** — it sits *above* whatever you run now
and whatever you move to later. In production the SPA and gateway ship as **one
container** (`omni-shell`) on port `3000`.

### Connect to (almost) anything

Because the reference broker is n8n — and anything n8n can reach becomes a
backend — the set of systems you can plug in is effectively open-ended, with no
fixed connector list to wait on (and a different broker can widen it further):

- **Inbound, via n8n** — any of n8n's hundreds of native integrations, *or* anything
  reachable over HTTP/REST/GraphQL/SOAP/gRPC/SQL through n8n's generic nodes.
  Jira today, a bespoke in-house API tomorrow, two backends at once — same UI.
- **Inbound, via webhook** — any tool can `POST` events straight into
  `/api/notifications/ingest` (secret-authenticated) to drive real-time updates.
- **Outbound, via webhook** — push OmniProject events to *any* endpoint — a SIEM,
  Slack, a customer system, or back into another n8n flow — HMAC-signed.

> **Implementing or integrating OmniProject?** See **[docs/TECHNICAL.md](docs/TECHNICAL.md)**
> for architecture and the security model, and **[docs/CONTRACT.md](docs/CONTRACT.md)**
> for the published broker contract (the interface a broker implements), the API
> surface, and data schemas.

---

## Features

- **Methodology views** — one dataset rendered as Kanban, Scrum (burndown/velocity), Gantt/Waterfall, PRINCE2 stages, RAID log, or list — switch per team. The view layer is **open** — add your own for a methodology we don't ship.
- **Issue management** — create / edit / delete from the board, a *New Issue*
  button, or the `Cmd+K` palette.
- **Enterprise reporting** (`/reports`) — Portfolio KPI cards (RAG), a Resource
  Heatmap (over-allocation alerts), and a Financial EVM chart (CPI/SPI).
- **Export & BI** — one-click report export to Excel, CSV, JSON, Markdown and PDF;
  a read-only API token plus an OData v4 read service and a Prometheus `/metrics`
  endpoint for Power BI / SAP / Grafana.
- **AI assist** — connect a local model (Ollama) or a public model (OpenRouter / OpenAI / Anthropic).
- **SSO** — env-gated OIDC against any provider; demo mode when unconfigured.
- **Keyboard-driven** — `Cmd+K` palette and `g d/p/r/s/e` navigation.

### Exploration mode — snapshots, what-if & dependencies *(Beta)*

`/explore` is a **deliberately separate, "NOT LIVE DATA" lab** for modelling, kept
visually distinct from the live app so a modelled or historical figure can never
be mistaken for production. Everything here is **client-side and session-volatile**
— it runs in your browser, the gateway stays stateless and zero-data-at-rest, and
you **download to keep** your work or it's discarded when you close the tab. The
four tools (see [docs/EXPLORATION.md](docs/EXPLORATION.md)):

- **Snapshots → trends** — capture the live portfolio at one or many points in
  time and chart the trend across them; export the set to keep a months-long
  history. An **auto-snapshot schedule** can capture on an interval until an end
  date/time (while the tab is open).
- **What-If sandbox** — fork the live portfolio into a throwaway copy and nudge
  coarse levers (completion, schedule, budget, blockers) to see the **baseline vs
  scenario** deltas recompute instantly. **Nothing is written back** — discard, or
  capture the scenario as a snapshot. A what-if can be based on the live state *or
  any captured snapshot*, so it's reproducible against a fixed baseline.
- **Cross-system dependency links by hash** — assert "A blocks B" across different
  tools by storing **only two SHA-256 fingerprints + minimal references — never any
  content** (so it can't become a shadow PM database), with live **drift detection**
  that flags when either side has changed since you linked them.

Every figure is provenance-badged (`captured` / `sample` / `replayed` / `projected`)
so it's never confused with live backend fact.

### Time-travel *(Experimental / preview)*

Opt-in, gated historical replay against a **logging server you own** — contract-
complete and tested at the seam, but **unproven end-to-end** (demo mode synthesises
sample data; the n8n blueprint is a template). **Off by default**, admin-only,
out-of-warranty egress. See [docs/TIME-TRAVEL.md](docs/TIME-TRAVEL.md).

---

## Safe to try with your real data

OmniProject is built so you can point it at production and stay in control the
whole way: **it stores nothing, you decide exactly what it can do, and every
write is guarded, reversible-by-design, and logged.**

**It holds no data.** No database, no cache, no copy of your projects. Trying it
changes nothing at rest — there's no export of your data into our system to leak,
lose, or get subpoenaed, and nothing to delete when you're done.

**You decide what it's allowed to do — because *you* write the n8n workflow.**
The gateway can only do what your n8n workflow implements. Wire only the read
actions (`list_projects`, `list_issues`, …) and OmniProject is **physically
read-only against your backend** — there is no write path. Add create/update/delete
later, when you trust it.

**Evaluate without touching anything:**

- **Dry-run / verify mode** — *Setup → Verify* probes your n8n per action with
  `{ verify: true }`; generated workflows short-circuit so **even reads never hit
  the backend**, and write actions are never probed.
- **Sandbox + instant rollback** — design and test integration config in a named
  **sandbox** environment, **promote** to production when happy, and **roll back**
  to a pinned known-good config in one click.
- **Read-only API tokens** — BI/automation clients get GET-only access; a leaked
  token can never mutate.

**Every real write is guarded:**

- **As the user, not a shared key** — the user's own OIDC token is forwarded, so
  the backend authorises each write under *their* identity. The gateway's RBAC is
  an extra gate, not the only one.
- **No silent overwrites** — optimistic concurrency (`expectedVersion`) returns a
  `409` instead of clobbering a change made elsewhere.
- **No duplicates or loops** — a deterministic idempotency key + an origin
  loop-guard stop double-writes and webhook storms.

**You can see and prove what happened:** a configurable **audit** log records
every action (who, what, status, latency) and can ship to your SIEM. **Provenance
badges** mark every figure as `sourced` / `derived` / `sample` (and `captured` /
`replayed` / `projected` in exploration mode), so computed or demo numbers are
never shown as backend fact.

**Hardened by default:** OIDC with full ID-token (JWKS) signature verification;
signed httpOnly session cookies with a **production fail-fast** if the session
secret is unset/default; **SSRF-guarded** admin-set outbound URLs; baseline
security headers; TLS gateway↔n8n in production; secret redaction in logs (and on
the settings read endpoint); rate limiting; and a supply chain with a dependency
release-age delay.

It's covered by **~640 automated tests** (240 gateway + 401 SPA) behind
**enforced CI coverage gates** (~84% gateway / ~88% SPA lines), an **axe-core
WCAG 2.1 AA accessibility** job, a live **n8n contract verification**, and a
**load-test harness** that exercises 2,000 concurrent users over 200 projects and
fails above a 1% error rate. (Honest caveat: SPA *function* coverage is ~64%, and
some flows are render-tested rather than interaction-tested — see
[docs/TESTING.md](docs/TESTING.md).)

> Full control inventory and the security review: **[SECURITY.md](SECURITY.md)**.
> The recommended first run is **demo mode** (below) — zero config, sample data —
> then a **read-only** workflow against one real backend. Step-by-step:
> **[docs/SAFE-FIRST-RUN.md](docs/SAFE-FIRST-RUN.md)**.

---

## Quick start (local, demo mode)

**Prerequisites:** Node.js 22+ and pnpm (`corepack enable`).

```bash
git clone https://github.com/walshd1/Omniproject.git
cd Omniproject
pnpm install
```

Run the gateway and SPA in two terminals:

```bash
# Terminal 1 — gateway (serves /api/*)
PORT=8080 pnpm --filter @workspace/api-server run dev

# Terminal 2 — SPA (Vite dev server; proxies /api → http://localhost:8080)
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/omniproject run dev
```

Open **http://localhost:5173**. With no `OIDC_*` set, the login screen shows
**ENTER (DEMO MODE)** and issues a local session — the whole app is usable with
sample data until you wire up n8n and SSO.

---

## Using OmniProject

- **Dashboard** (`g d`) — switch the methodology lens; drag cards between columns
  to change status; click a card or press *New Issue* to edit.
- **Projects** (`g p`) — index with per-project summary; open a project for its board.
- **Reports** (`g r`) — portfolio RAG rollup, resource allocation heatmap, and
  Earned-Value financials per project.
- **Explore** (`g e`) — the modelling lab (snapshots, what-if, dependency links),
  clearly separated from live data — see [docs/EXPLORATION.md](docs/EXPLORATION.md).
- **Settings** (`g s`) — broker URL (n8n by default), backend routing hint, AI
  provider + model, OIDC issuer, and the opt-in logging-sync egress.
- **Command palette** — `Cmd+K` for navigation and quick actions.
- **Export** — the *Export* menu downloads `.xlsx` / `.csv` etc.; for Power BI see
  *Configuration* → `API_TOKENS` and the [technical doc](docs/TECHNICAL.md#2-identity--access).

---

## Deployment

The `Dockerfile` builds the single **`omni-shell`** image (SPA + gateway on port
`3000`). Liveness/readiness probes hit `/api/healthz`.

```bash
docker build -t omniproject-shell:latest .
```

### Standalone (bundled Authentik IdP — fastest to evaluate)

Includes `omni-shell`, `n8n`, `ollama`, Traefik, and Authentik, routed on
`*.local` over local-CA TLS (mkcert). See [docs/DEPLOY-LOCAL.md](docs/DEPLOY-LOCAL.md).

```bash
docker compose -f docker-compose.standalone.yml up -d
```

Then in Authentik create an OAuth2 provider for OmniProject with redirect URI
`https://app.local/api/auth/callback` and set `OIDC_CLIENT_SECRET` to match.
Access the shell at **https://app.local**.

### Enterprise (BYO-SSO, lightweight)

No Traefik/Authentik/DB/LLM — just `omni-shell` + a single n8n on an isolated
bridge. Supply your own OIDC provider and backend URLs.

```bash
export OIDC_ISSUER_URL=https://your-idp.example.com/...
export OIDC_CLIENT_ID=...  OIDC_CLIENT_SECRET=...  PUBLIC_URL=https://omni.example.com
export PLANE_INSTANCE_URL=...  OPENPROJECT_INSTANCE_URL=...   # or your own backends
docker compose -f docker-compose.enterprise.yml up -d
```

### Kubernetes

```bash
# create the real Secret out-of-band first (the manifest ships placeholders empty),
# then:
kubectl apply -f k8s-enterprise-manifest.yaml
```

### Behind an existing reverse proxy

Already running Traefik / Caddy / nginx? Point it at `omni-shell:3000` (the
container serves API + SPA on one plain-HTTP port; health is `/api/healthz`) and
terminate TLS at the edge — don't publish a host port. Traefik label example and
the common gotchas (router-name consistency, the `Host()` backticks, cross-provider
`@file` middleware, basic-auth escaping): **[docs/REVERSE-PROXY.md](docs/REVERSE-PROXY.md)**.

### Sizing

| Scenario | CPU | RAM | Disk |
| -------- | --- | --- | ---- |
| Dev — shell only (demo) | 2 cores | 4 GB | ~2 GB |
| Enterprise — omni-shell + n8n (BYO SSO/backends) | 2 vCPU | 4 GB | 10 GB |
| Standalone (+ Authentik) | 4 cores | 8–16 GB | 20 GB+ |
| Standalone + local LLM (Ollama) | 4–8 cores | 16–32 GB | 30 GB+ |

> Your **backends** (Plane, OpenProject, …) are sized separately. The k8s
> `omni-shell` pod requests `256Mi`/`100m`, limits `512Mi`/`500m`.

---

## Configuration

| Variable | Used by | Description |
| -------- | ------- | ----------- |
| `PORT` | gateway, SPA dev | Listen port (gateway serves API + SPA in prod) |
| `BASE_PATH` | SPA build | Base path for the SPA (e.g. `/`) |
| `PUBLIC_URL` | gateway | Public origin, used to build the OIDC redirect URI |
| `BROKER_URL` | gateway | Target broker webhook (n8n by default); when set, all data is brokered through it (else demo data) |
| `BROKER_URLS` | gateway | Optional comma-separated **pool** of n8n instances; the broker round-robin load-balances across them with failover (overrides `BROKER_URL`). Pair with n8n queue mode for horizontal scale. |
| `SESSION_SECRET` | gateway | Signs the session cookie; **required in production** (the gateway refuses to boot on a default/empty value) and shared across replicas |
| `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | gateway | Enable real SSO (all three required) |
| `OIDC_SCOPE` | gateway | Scopes (default `openid profile email`) |
| `API_TOKENS` | gateway | Comma-separated **read-only** tokens for Power BI / scheduled exports |
| `AI_PROVIDER` | gateway | `none \| ollama \| openrouter \| openai \| anthropic` |
| `AI_MODEL` | gateway | Model name (per-provider default otherwise) |
| `OLLAMA_URL` / `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | gateway | Provider connection (per `AI_PROVIDER`) |
| `LOGGING_SYNC_URL` / `LOGGING_SYNC_ACK_WARRANTY` | gateway | Opt-in state-history egress for time-travel (off by default; out-of-warranty) |
| `STATIC_DIR` | gateway | Serve the built SPA from here (single-container mode; set by the image) |
| `API_PROXY_TARGET` | SPA dev | Where the Vite dev server proxies `/api` (default `http://localhost:8080`) |

n8n workflows additionally read backend endpoints such as `PLANE_INSTANCE_URL` /
`OPENPROJECT_INSTANCE_URL`. See the [technical doc](docs/TECHNICAL.md) for the
full security and integration reference.

---

## Documentation

- **[docs/TECHNICAL.md](docs/TECHNICAL.md)** — architecture, n8n contract,
  security model, API surface, data schemas, extending the system.
- **[docs/BROKER.md](docs/BROKER.md)** — the `Broker` seam and its invariants.
- **[docs/METHODOLOGIES.md](docs/METHODOLOGIES.md)** — the methodology views and
  how to add your own (no black-boxed designer).
- **[docs/N8N-WORKFLOWS.md](docs/N8N-WORKFLOWS.md)** — generate, wire & verify
  workflows; what's open vs. the licensed prebuilt enterprise integrations.
- **[docs/REVERSE-PROXY.md](docs/REVERSE-PROXY.md)** — putting omni-shell behind
  your existing Traefik / Caddy / nginx on a public URL.
- **[docs/TESTING.md](docs/TESTING.md)** — the test pillars and the CI coverage gates.
- **[docs/EXPLORATION.md](docs/EXPLORATION.md)** — *(Beta)* Exploration mode:
  snapshots → trends, What-If sandbox, and cross-system dependency links by hash.
- **[docs/TIME-TRAVEL.md](docs/TIME-TRAVEL.md)** — *(Experimental)* opt-in,
  out-of-warranty historical replay against a logging server you own.
- **[artifacts/n8n-blueprints/](artifacts/n8n-blueprints/)** — the importable
  reference workflows (core sync + time-travel template).
- **[LICENSING.md](LICENSING.md)** — the open-core model (Apache core + premium).
- **[CONTRIBUTING.md](CONTRIBUTING.md)** · **[CHANGELOG.md](CHANGELOG.md)** ·
  **[SECURITY.md](SECURITY.md)** · **[AGENTS.md](AGENTS.md)** · **[.env.example](.env.example)**.

---

## Maturity & status

OmniProject is pre-1.0. Not everything is at the same level of maturity — features
are tagged so a preview is never mistaken for a production guarantee:

- **Stable** (tested, production-intended) — the overlay core (broker seam,
  OIDC/RBAC, methodology views, reporting/exports, demo mode); the automated test
  suites and CI coverage gates; and the security hardening. *Caveat:* SPA function
  coverage is ~64% and some flows are render-tested only — see
  [docs/TESTING.md](docs/TESTING.md).
- **Beta** (functional and tested, but new and not yet hardened by real use) —
  [Exploration mode](docs/EXPLORATION.md): snapshots → trends, auto-snapshot
  (tab-open only), the coarse What-If sandbox, and dependency-by-hash. All
  client-side, session-volatile, download-to-keep.
- **Experimental** (complete at the seam, **unproven end-to-end**) —
  [time-travel](docs/TIME-TRAVEL.md) and the opt-in logging-sync egress: demo mode
  synthesises sample replay data, the n8n blueprint is a template, and there is no
  integration test against a real logging server yet. Off by default, admin-only,
  out-of-warranty.

See the [CHANGELOG (0.4.0)](CHANGELOG.md) for per-feature detail.

---

## License & status

**Open-core.** The core is **Apache-2.0** ([`LICENSE`](LICENSE)) — free for any
use, including commercial. A small set of **premium features** (white-label
branding, company nomenclature, outbound webhooks, and the **prebuilt enterprise
workflows** for SAP / Primavera / Dynamics 365 / Project) is source-available
under the **OmniProject Premium License** ([`LICENSE-PREMIUM.txt`](LICENSE-PREMIUM.txt))
and requires a licence key to run in production. See **[LICENSING.md](LICENSING.md)**
for the full model, including how purchases auto-mint a key via Stripe/Gumroad.

**The tools to *build* are open — only prebuilt convenience is paid.** Adding a
**methodology view**, and **building an n8n workflow** for any backend (including
wiring **SAP yourself** with the open generator plus the generic "Enterprise
backbone" preset), are **free, Apache-2.0, and fully documented** — nothing about
*how* is black-boxed. What's paywalled is the *prebuilt, ready-to-import*
enterprise integrations: **you pay to skip the effort, not for permission.** And
if you'd rather not build it yourself, we can build a view or workflow for you as
an **optional paid service** — selling our time, delivered as ordinary open source
you own. See
[LICENSING.md → Licensed features vs. professional services](LICENSING.md#licensed-features-vs-professional-services).

> **No warranty.** OmniProject is pre-1.0 and provided **AS IS, without warranty
> of any kind**. A licence key entitles *use* of the premium features; it does
> **not** include support or any service-level commitment — so a paid prebuilt
> integration is a **head-start, not a fix-it guarantee**. **Paid support /
> maintained-tier packages are planned** as a separate offering as the community
> grows — until then, help is best-effort and community-based.
</content>
