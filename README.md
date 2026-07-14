# OmniProject

[![CI](https://github.com/walshd1/Omniproject/actions/workflows/ci.yml/badge.svg)](https://github.com/walshd1/Omniproject/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Discussions](https://img.shields.io/badge/community-discussions-blueviolet.svg)](https://github.com/walshd1/Omniproject/discussions)

How many tabs do you have open right now just to answer *"where do things
actually stand"?* Jira for engineering, a spreadsheet for budget, ServiceNow
for the support queue, SAP for the numbers finance trusts, and a status deck
someone rebuilds by hand every Friday. Nobody's going to migrate all of that
into one tool — and you shouldn't have to.

**OmniProject gives you one dashboard across all your project tools, without copying any of your data out of them.**

### Why OmniProject exists

Three problems keep showing up together, at every org from a 5-person charity
to a multinational running SAP:

1. **Tool sprawl.** Engineering lives in Jira, finance trusts SAP, support runs
   through ServiceNow, and someone still keeps a spreadsheet nothing else
   covers. No single tool is "wrong" — but no single person can see across all
   of them without a Friday afternoon spent copy-pasting into a status deck.
2. **Nobody trusts a second copy.** Every "unified" tool we looked at solves
   sprawl by importing your data into *itself* — and the moment it has its own
   copy, that copy starts drifting from the real thing. Now someone has to
   answer "which number is actually true" and audit yet another place data
   at rest can leak from.
3. **Migration is the actual blocker, not the idea.** Everyone agrees a single
   view across tools would help. Almost nobody can get their org to rip out
   Jira, SAP and ServiceNow to get it — the migration risk kills the project
   before it starts.

OmniProject's answer is to not be a fourth place your data lives: it's a live
window onto the tools you already run, so there's nothing to migrate, nothing
to keep in sync, and nothing new to secure. That's the whole bet — see **[How
OmniProject works](#how-omniproject-works)** below for how it's built to keep
that promise structurally, not just by policy.

It's free to self-host (Apache-2.0), and it works alongside what you already use — a
spreadsheet, Trello, Jira, OpenProject, SAP, whatever — instead of asking you to move
into something new. Pick the door that's you:

## 🧑‍🤝‍🧑 For small teams & charities

You're already using something to track your work — a spreadsheet, Trello, Jira,
OpenProject. Keep it. OmniProject sits on top and gives you a dashboard, a board view
and simple reports, without you changing how your team works or moving your data
anywhere. It doesn't keep its own copy of anything — nothing of yours gets copied
into OmniProject, so there's nothing new to back up, secure or worry about leaking.
It's **free to self-host, with no per-seat fees**, has a bundled login system so you
don't need corporate IT, and a one-click **"We're a charity"** setup gives you a
trustee report and a funder report ready to go. No Docker host of your own? A
manual, no-terminal-once-it's-up recipe for running OmniProject on
[Railway](docs/ops/RAILWAY-DEPLOY.md) is the fastest path today — a real
"Deploy on Railway" button is next once that's been run and confirmed by a
maintainer. Full walkthrough, written for
non-technical readers: **[docs/SMALL-ORG-GUIDE.md](docs/SMALL-ORG-GUIDE.md)**. If
you're wondering whether the enterprise-grade work has priced small orgs out: it
hasn't — see the audit: **[docs/archive/reviews/SME-CHARITY-FIT.md](docs/archive/reviews/SME-CHARITY-FIT.md)**.

## 🏢 For enterprises

Any serious evaluation starts with two objections: *"we're not ripping out Jira/SAP/
ServiceNow"* and *"this can't become a new place our data can leak from."* OmniProject
is built to answer both by design, not by policy — it keeps no database of its own, so
every read and write goes live to the system that already owns the data, and there's
no copy of your data sitting in a new place to secure, audit or lose. The buyer-panel
gap analysis (CEO, Finance, Compliance, CISO, IT, Projects — what's delivered today,
what's not, cited to source): **[docs/ENTERPRISE-READINESS.md](docs/ENTERPRISE-READINESS.md)**.
For the IAM/CISO team: the **[docs/SSO-SCIM.md](docs/SSO-SCIM.md)** runbook covers SAML
SSO + SCIM provisioning/deprovisioning end to end, and
**[docs/DATA-RESIDENCY.md](docs/DATA-RESIDENCY.md)** covers the fail-closed control
that keeps a region's traffic from ever leaving it.

## 🛠️ For engineers

OmniProject is a **stateless, zero-at-rest, broker-agnostic overlay**: every read and
write is brokered *live* to your real backend through one swappable seam (a published,
generated contract), with n8n as the reference broker — swap it for anything that
implements the same contract and nothing above the seam moves. Start with
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** (the one-sitting system overview),
then **[docs/READING-GUIDE.md](docs/READING-GUIDE.md)** (subsystem → entry-point map).
The rest of this README goes deep on the same material below. Looking for a
specific audit, runbook or design doc instead? **[docs/DOCUMENTATION-INDEX.md](docs/DOCUMENTATION-INDEX.md)**
maps everything under `docs/` by purpose.

---

## 🧪 We're looking for testers

This project is past the "does it work" stage and into the "does it survive
contact with someone else's real Jira/SAP/OpenProject" stage — and that only
happens with people other than the maintainer actually running it. If you'll
give it 15 minutes against a real backend (read-only — nothing you wire can
write until you decide it's earned that) and tell us what broke, confused you,
or was missing, that's worth more right now than almost any feature request.

**[docs/QUICKSTART.md](docs/QUICKSTART.md)** gets you from clone to your own
data on screen in about 15 minutes. Then open a
**[🧪 tester sign-up issue](https://github.com/walshd1/Omniproject/issues/new?template=beta_tester.yml)** — or
just tell us what happened, good or bad, in
**[Discussions](https://github.com/walshd1/Omniproject/discussions)**. Every honest "this didn't work for me"
is more useful than a star.

---

## How OmniProject works

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
- **Swap or add backends without migrating** — anything the broker can reach can be
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
  (each backend reports its own currency; convert to one display currency —
  cross-currency roll-ups *exclude and count* any row whose rate is missing rather
  than folding a raw foreign amount into the total).
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

- **Inbound, via the broker** — with n8n as the reference broker, any of its hundreds
  of native integrations, *or* anything reachable over HTTP/REST/GraphQL/SOAP/gRPC/SQL
  through its generic nodes. Jira today, a bespoke in-house API tomorrow, two backends
  at once — same UI.
- **Internally-hosted / legacy with no API** — **admin-gated raw SQL** (Postgres /
  MySQL / SQL Server) and **MongoDB** backends, reached through a sidecar that owns
  the parameterised queries + credentials, so the gateway **never ships raw SQL**
  and stays stateless. See [docs/ops/DATABASE-BACKENDS.md](docs/ops/DATABASE-BACKENDS.md).
- **One-shot from a spreadsheet** — an **Excel/CSV import** source with a column/
  field mapper, for legacy systems that can only export a sheet.
- **No existing tool at all?** An **optional, customer-owned stateful database** (a
  superset-native, OpenProject-compatible Postgres schema *below* the broker seam) for greenfield
  teams with nothing to connect. The **non-preferred** path — the gateway stays stateless and the
  data is the customer's to govern. Design + schema: [docs/SELF-HOST-DB.md](docs/SELF-HOST-DB.md).
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
- **A broker-agnostic API** — the consumer-facing API lives *above* the swappable
  broker seam, so it's the same regardless of which broker reaches your backends.
  The full **OpenAPI spec is served at runtime** (`GET /api/openapi.yaml`) with a
  JSON discovery doc (`GET /api/discovery`) — build against a stable contract, not
  against n8n. (The *southbound* contract a broker implements is the separate
  `GET /api/contract`.)
- **Export & BI** — one-click report export to Excel, CSV, JSON, Markdown and PDF;
  a read-only API token plus an OData v4 read service and a Prometheus `/metrics`
  endpoint for Power BI / SAP / Grafana; and a read-only **MCP server** (write
  tools opt-in) so an AI agent can read through the same seam — see [docs/MCP.md](docs/MCP.md).
- **Import** — bring work items in from an **Excel/CSV** export (or any tabular
  source) with a **column → canonical-field mapper** that auto-suggests mappings
  (exact / synonym / fuzzy); preview, confirm, then write through your live
  backend. See [docs/ops/IMPORT.md](docs/ops/IMPORT.md).
- **Business rulesets** — a PMO-configurable **governance** engine layered on top
  of the hard security rules: require an assignee/estimate, freeze a portfolio,
  ban deletes, enforce schedule sanity — all **restrict-only** (it can tighten,
  never grant). Ships **reference rulesets per methodology** (Scrum, Kanban,
  Waterfall, PRINCE2, SAFe) for compliance + completeness. See
  [docs/ops/BUSINESS-RULES.md](docs/ops/BUSINESS-RULES.md).
- **Roles & access** — a linear base ladder (viewer → contributor → manager) plus
  two **orthogonal, joinable authorities**: **PMO** (business governance) and
  **admin** (technical config). An admin-only, audited **role-mapping editor** maps
  IdP groups to roles at runtime. See [docs/ops/ROLES.md](docs/ops/ROLES.md).
- **AI assist** — connect a local model (Ollama) or a public model (OpenRouter / OpenAI / Anthropic).
- **SSO** — env-gated OIDC against any provider; demo mode when unconfigured.
- **Keyboard-driven** — `Cmd+K` palette and `g d/p/r/s/e` navigation.

### Seven integration planes — separate but linked

Everything pluggable in OmniProject is modelled the same way: a neutral manifest
with **capabilities kept separate from concrete tools, linked into one
definition**, in a shared catalogue (`@workspace/backend-catalogue`). There are
**seven planes**, each its own registry: **backends** (systems of record),
**brokers** (the automation/translation layer), **outputs** (MCP/OData/BI/metrics/
exports), **notifications** (Slack/Teams/email/incident channels), **methodologies**
(Scrum/Kanban/Waterfall/…), **reports** (Gantt/burndown/EVM/…) and **screens** (the
SPA views). A plane verifier (`pnpm --filter @workspace/scripts verify-plane`) keeps
every shipped entry honest. See [docs/INTEGRATION-PLANES.md](docs/INTEGRATION-PLANES.md).

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
- **Tiered RBAC** — viewer → contributor → manager, plus two orthogonal,
  joinable authorities: **PMO** (business governance) and **admin** (technical
  config). Group→role mapping is env-configured and runtime-editable by an admin.
- **Business rulesets** — an extra, PMO-configurable governance layer that is
  **restrict-only**: it runs *after* the hard gates and can only deny or warn,
  never grant — so it can codify policy (require fields, freeze writes, ban
  deletes) without ever becoming a way to escalate privilege.
- **No silent overwrites** — optimistic concurrency (`expectedVersion`) returns a
  `409` instead of clobbering a change made elsewhere.
- **No duplicates or loops** — a deterministic idempotency key + an origin
  loop-guard stop double-writes and webhook storms.

**You can see and prove what happened:** a configurable **audit** log records
every action (who, what, status, latency) and can ship to your SIEM. **Provenance
badges** mark every figure as `sourced` / `derived` / `sample` (and `captured` /
`replayed` / `projected` in exploration mode), so computed or demo numbers are
never shown as backend fact.

**Malformed backend data can't reach your screens:** an always-on **sanitizer** at
the broker read seam repairs every incoming row to the contract shape — junk numbers
become safe defaults, missing required strings become `""`, enums are canonicalised,
and prototype-pollution keys (`__proto__`/`constructor`/`prototype`) are stripped from
untyped rows — fail-soft, once, before anything is cached or derived. Repairs are
tallied and surfaced (a `Data repaired` badge + `X-OmniProject-Data-Repaired` header),
so a flaky backend degrades visibly instead of quietly corrupting a roll-up.

**Hardened by default:** OIDC with full ID-token (JWKS) signature verification;
signed httpOnly session cookies with a **production fail-fast** if the session
secret is unset/default; **SSRF-guarded** admin-set outbound URLs; baseline
security headers; TLS gateway↔n8n in production; secret redaction in logs (and on
the settings read endpoint); rate limiting; and a supply chain with a dependency
release-age delay.

It's covered by **5,000+ automated tests** (~2,600 gateway + ~2,860 SPA — these
counts grow with nearly every merge; see [docs/TESTING.md](docs/TESTING.md) for
how to get a current count rather than trusting a hardcoded one) behind
**enforced CI coverage gates** (82% lines / 84% functions gateway; 94% lines /
89% functions SPA), plus **StrykerJS mutation testing** over the
financial-derivation core (weekly CI — see
[docs/MUTATION-TESTING.md](docs/MUTATION-TESTING.md)). Accessibility is held by an
**axe-core regression gate** and a full **WCAG 2.2 AA audit**
([docs/ACCESSIBILITY-AUDIT.md](docs/ACCESSIBILITY-AUDIT.md); the browser CI job runs
axe at WCAG 2.1 A/AA). Rounding it out: a live **n8n contract verification** and a
**load-test harness** (`pnpm --filter @workspace/scripts run load`) that can drive
configurable concurrency against a real gateway → broker → backend path and fails
above a 1% error rate — but the harness **has not yet been run for real**: it ships
and is unit-tested, yet queue-mode n8n throughput numbers are still a placeholder
(see [docs/ops/LOAD-HARNESS.md](docs/ops/LOAD-HARNESS.md)). (Honest caveat: some SPA
flows are render-tested rather than interaction-tested — see
[docs/TESTING.md](docs/TESTING.md).)

> Full control inventory and the security review: **[SECURITY.md](SECURITY.md)**.
> **We invite independent code audit and penetration testing** — scope, rules of
> engagement and safe-harbour terms are in SECURITY.md, with a machine-readable
> pointer at `/.well-known/security.txt`. The recommended first run is **demo
> mode** (below) — zero config, sample data — then a **read-only** workflow against
> one real backend. Step-by-step: **[docs/SAFE-FIRST-RUN.md](docs/SAFE-FIRST-RUN.md)**.

---

## Quick start (local, demo mode)

**Prerequisites:** Node.js 26+ and pnpm (`corepack enable`).

> Want to go straight to your own real data (read-only) instead of stopping at
> sample data? **[docs/QUICKSTART.md](docs/QUICKSTART.md)** is the same steps
> below plus wiring one real backend, in about 15 minutes.

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

### Small teams, charities & self-hosters

OmniProject is **free to run and opt-in-hardened** — SSO, KMS, IP allowlists and
the rest are all off by default, and the whole product works without them. Point a
free/open backend (**OpenProject**, **Plane**, or **Excel / Sheets**) at it and you
get projects, boards, reports and dashboards for **no per-seat cost**. Pick your
context in the setup wizard (**Business/SME · Non-profit/charity · Self-hosted**) so
plain HTTP-on-a-LAN and the bundled IdP just work, and lean on the charity/SME
starter templates (**grant tracking**, **fundraising pipeline**, **volunteer
roster**) plus the copilot's charity/SME lenses. A charity can go further in one
click: the setup wizard's **"We're a charity"** button switches to the non-profit
profile *and* adds a **trustee report** and a **funder report** to your dashboards
in a single step — no separate widget-picking required. Full walkthrough of what you
need and what you can safely skip: **[docs/SMALL-ORG-GUIDE.md](docs/SMALL-ORG-GUIDE.md)**.

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

### Slim (small orgs & charities — smallest real deployment)

The leanest real deployment: `omni-shell` + a single n8n, nothing else. No
Traefik, no Authentik, no database, no local LLM. Demo auth and plain HTTP on
your LAN are accepted choices for a single small team (`DEPLOYMENT_PROFILE`
defaults to `self-hosted`) — wire real OIDC SSO later, whenever more than one
person needs their own account. See **[docs/SMALL-ORG-GUIDE.md](docs/SMALL-ORG-GUIDE.md)**.

```bash
export SESSION_SECRET=$(openssl rand -hex 32)
docker compose -f docker-compose.slim.yml up -d
```

Open `http://<this-box's-address>:3000`. For remote (non-LAN) access, put a
TLS reverse proxy in front (**[docs/REVERSE-PROXY.md](docs/REVERSE-PROXY.md)**)
and set `PUBLIC_URL` to its https origin.

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
| Slim — omni-shell + n8n, demo/self-hosted auth | 1 vCPU | 2 GB | 5 GB |
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
| `BROKER_KINDS` | gateway | Optional comma-separated list of additional broker **kinds** wired below the seam (catalogue ids, e.g. `n8n,make`). Their capabilities are unioned into the surface set so assets needing a broker capability (e.g. outbound events) light up; the live data hop stays the configured synchronous broker. Unknown ids are ignored. |
| `BROKER_ENDPOINTS` | gateway | Optional per-kind broker endpoints for heterogeneous dispatch, e.g. `n8n=https://n8n/webhook,node-red=http://localhost:1880/omniproject` (a kind may list several URLs with `\|` for a same-kind pool). A command routed to a kind (see `brokerForCommand`) is bound to that kind's URL over the uniform HTTP contract. A kind with no endpoint falls back to `BROKER_URL`, so single-broker deployments are unchanged. |
| `OMNI_DEV_MODE` | gateway | **Dev only.** `1` marks this a developer/debug instance — the SPA shows a DEV MODE watermark and `/api/setup/debug-bundle` is available. Inert under `NODE_ENV=production`. The `docker-compose.dev.yml` override sets this. |
| `BROKER_TRACE` | gateway | **Dev only.** `1` traces every broker method call at the seam (`→`/`←` with timing) via the pino logger. Inert under `NODE_ENV=production` regardless of this flag; off by default. Redaction-by-default — credentials are never emitted and arg/result values are summarised to their shape. |
| `BROKER_TRACE_PAYLOADS` | gateway | **Dev only.** `1` additionally emits full (secret-scrubbed) request/response payloads in trace output, not just shapes. Requires `BROKER_TRACE=1`; inert in production. Use with care — real payloads carry backend PII. |
| `BROKER_SPOOF` | gateway | **Dev only.** A vendor id (e.g. `openproject`) for the dev broker to present AS — serves data gated to that vendor's declared capabilities, no real backend. Switchable at runtime via `POST /api/dev-mode/broker`. Inert in production. |
| `DEV_BROKER_SOURCE` | gateway | **Dev only.** The dev broker's data source: `demo` (default, built-in sample), `bundle` (a debug bundle's `demo-state.json`), or `cassette` (a captured traffic tape, replayed). Pair `bundle`/`cassette` with `DEV_BROKER_REF`. |
| `DEV_BROKER_REF` | gateway | **Dev only.** Path to the `demo-state.json` (for `bundle`) or capture tape (for `cassette`) the dev broker loads as its data. |
| `OMNI_DEV_MODE_ACK_INSECURE` | gateway | **Dev only, last resort.** `1` downgrades the dev-mode boot refusal (when production signals like real OIDC/licence/public host are present) to a loud warning — for local testing against real OIDC only. Never use on a real deployment. |
| `BROKER_CAPTURE` | gateway | **Dev only.** Path to an append-only JSONL *capture tape*: every plane exchange (broker/notify/export) is recorded (full but secret-scrubbed) for replay on another instance via `pnpm broker:replay`. Inert under `NODE_ENV=production`; a tape is real activity on disk, so it is a non-prod/CI artifact kept out of the production image. |
| `READ_CACHE_TTL_MS` | gateway | **Opt-in performance mode (off by default).** Milliseconds to cache broker reads in memory. **This relaxes the "never stale" guarantee** — reads may be up to this old — so it is announced loudly at boot and flagged by the security self-check in production. Per-actor keyed (no cross-user leak), write-through (your writes invalidate it), per-replica, RAM-only. Use for dispersed/high-latency deployments where a few seconds of staleness is acceptable; unset for fully live reads. |
| `SESSION_SECRET` | gateway | Signs the session cookie; **required in production** (the gateway refuses to boot on a default/empty value) and shared across replicas |
| `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | gateway | Enable real SSO (all three required) |
| `OIDC_SCOPE` | gateway | Scopes (default `openid profile email`) |
| `OIDC_{ADMIN,PMO,MANAGER,CONTRIBUTOR,VIEWER}_ROLES` | gateway | Comma lists mapping IdP groups → roles (admin/PMO are orthogonal authorities; runtime-editable via `/api/admin/role-map`). `OIDC_DEFAULT_ROLE` sets the no-match fallback |
| `BUSINESS_RULE_MODES` / `BUSINESS_FIELD_RULES` | gateway | Optional JSON seed for the business ruleset (built-in rule modes + field rules); also editable by the PMO at runtime |
| `SQL_SIDECAR_URL` / `SQL_SIDECAR_TOKEN` · `MONGO_SIDECAR_URL` / `MONGO_SIDECAR_TOKEN` | sidecar | Connection for the admin-gated raw-SQL / MongoDB backends (the sidecar holds the DB credentials) |
| `NOTIFY_INGEST_SECRET` | gateway | Bearer that authenticates inbound real-time events on `/api/notifications/ingest` |
| `API_TOKENS` | gateway | Comma-separated **read-only** tokens for Power BI / scheduled exports |
| `AI_PROVIDER` | gateway | `none \| ollama \| openrouter \| openai \| anthropic` |
| `AI_MODEL` | gateway | Model name (per-provider default otherwise) |
| `OLLAMA_URL` | gateway | Local Ollama endpoint (not a secret) |
| `VAULT_KEY` | gateway | Root secret protecting the AI key vault (base64 32 bytes; derived from `SESSION_SECRET` if unset). **Provider API keys are entered in Settings → AI providers and stored in the encrypted vault — never as env vars.** |
| `LOGGING_SYNC_URL` / `LOGGING_SYNC_ACK_WARRANTY` | gateway | Opt-in state-history egress for time-travel (off by default; out-of-warranty) |
| `STATIC_DIR` | gateway | Serve the built SPA from here (single-container mode; set by the image) |
| `API_PROXY_TARGET` | SPA dev | Where the Vite dev server proxies `/api` (default `http://localhost:8080`) |

n8n workflows additionally read backend endpoints such as `PLANE_INSTANCE_URL` /
`OPENPROJECT_INSTANCE_URL`. See the [technical doc](docs/TECHNICAL.md) for the
full security and integration reference.

---

## Documentation

### For engineers / auditors

New to the codebase, or auditing it? Start with these three — they are designed to
be read in one sitting and let you *see* how the system works (architecture, the
seam, the data flows, the key sequences) without reverse-engineering the code. Every
diagram and claim is cross-checked against the source and cites the file it lives in.

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — the system overview: the
  stateless / zero-at-rest model, the layer cake, the broker seam, where config
  lives, the security spine, and dev-mode gating (Mermaid component + seam diagrams).
- **[docs/SEQUENCES.md](docs/SEQUENCES.md)** — seven traced walkthroughs (Mermaid
  sequence diagrams + prose) for auth/session, a broker read through the decorator
  chain, an optimistic-concurrency write, capability resolution, snapshot
  sign/verify, notification dispatch, and dev-mode gating.
- **[docs/READING-GUIDE.md](docs/READING-GUIDE.md)** — "where do I look to
  understand X": a subsystem → entry-point-file map (pointing at the per-function
  index below) plus a glossary of the domain vocabulary.

Everything else under `docs/` — audits, runbooks, design proposals — is mapped by
purpose in **[docs/DOCUMENTATION-INDEX.md](docs/DOCUMENTATION-INDEX.md)**.

### Reference

- **For enterprise buyers → [docs/ENTERPRISE-READINESS.md](docs/ENTERPRISE-READINESS.md)**
  — a buyer-panel gap analysis (CEO, Finance, Compliance, CISO, IT, Projects): what
  OmniProject already delivers per seat, the gaps to close, and a prioritised
  enterprise-readiness roadmap.
- **[docs/TECHNICAL.md](docs/TECHNICAL.md)** — architecture, n8n contract,
  security model, API surface, data schemas, extending the system.
- **[docs/FUNCTION-MAP.md](docs/FUNCTION-MAP.md)** — generated per-function index of
  every source file (CI-drift-guarded).
- **[docs/BROKER.md](docs/BROKER.md)** — the `Broker` seam and its invariants.
- **[docs/INTEGRATION-PLANES.md](docs/INTEGRATION-PLANES.md)** — the seven
  integration planes and the shared catalogue, with a per-plane dev guide under
  [docs/dev/](docs/dev/) and the `verify-plane` tool.
- **[docs/METHODOLOGIES.md](docs/METHODOLOGIES.md)** — the methodology views and
  how to add your own (no black-boxed designer).
- **[docs/ops/ROLES.md](docs/ops/ROLES.md)** — the RBAC model (base ladder + the
  orthogonal PMO/admin authorities) and the admin-only role-mapping editor.
- **[docs/ops/BUSINESS-RULES.md](docs/ops/BUSINESS-RULES.md)** — the restrict-only
  business ruleset engine and the per-methodology reference rulesets.
- **[docs/ops/IMPORT.md](docs/ops/IMPORT.md)** — Excel/CSV import and the
  column/field mapper.
- **[docs/ops/DATABASE-BACKENDS.md](docs/ops/DATABASE-BACKENDS.md)** — the
  admin-gated raw-SQL / MongoDB backends for internally-hosted / legacy stores.
- **[docs/N8N-WORKFLOWS.md](docs/N8N-WORKFLOWS.md)** — generate, wire & verify
  workflows; what's open vs. the licensed prebuilt enterprise integrations.
- **[docs/REVERSE-PROXY.md](docs/REVERSE-PROXY.md)** — putting omni-shell behind
  your existing Traefik / Caddy / nginx on a public URL.
- **[docs/TESTING.md](docs/TESTING.md)** — the test pillars and the CI coverage gates.
- **[docs/EXPLORATION.md](docs/EXPLORATION.md)** — *(Beta)* Exploration mode:
  snapshots → trends, What-If sandbox, and cross-system dependency links by hash.
- **[docs/TIME-TRAVEL.md](docs/TIME-TRAVEL.md)** — *(Experimental)* opt-in,
  out-of-warranty historical replay against a logging server you own.
- **[docs/OPERATIONS.md](docs/OPERATIONS.md)** — scaling, high availability,
  disaster recovery/backup, and enabling OTLP telemetry.
- **Quality & stress-test audits** — point-in-time findings run against this
  codebase: **[docs/archive/reviews/CLEAN-CODE-AUDIT.md](docs/archive/reviews/CLEAN-CODE-AUDIT.md)** (duplication /
  consistency), **[docs/archive/reviews/PERF-PATTERNS-REVIEW.md](docs/archive/reviews/PERF-PATTERNS-REVIEW.md)**
  (speed/responsiveness at scale), **[docs/archive/reviews/RESILIENCE-FINDINGS.md](docs/archive/reviews/RESILIENCE-FINDINGS.md)**
  (messy-data stress pass), **[docs/archive/reviews/LOGIC-FINDINGS.md](docs/archive/reviews/LOGIC-FINDINGS.md)**
  (identity-collision / unstable-sort audit),
  **[docs/archive/reviews/BUNDLED-BACKENDS-STRESS.md](docs/archive/reviews/BUNDLED-BACKENDS-STRESS.md)** (every
  bundled backend/broker definition stress-tested), and
  **[docs/archive/reviews/SECURITY-AUDIT-2026-07.md](docs/archive/reviews/SECURITY-AUDIT-2026-07.md)** (re-audit of
  the newest surfaces).
- **[docs/archive/reviews/I18N-COVERAGE.md](docs/archive/reviews/I18N-COVERAGE.md)** — the localisation coverage
  audit for the i18n dictionary (en/fr/de/es).
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
  suites and CI coverage gates; and the security hardening. *Caveat:* some SPA
  flows are render-tested rather than interaction-tested — see
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
under the **OmniProject Premium License** ([`licenses/PREMIUM.txt`](licenses/PREMIUM.txt)).
**During the pre-community period these premium features are free to run** —
enforcement is dormant (deliberate and temporary). See **[LICENSING.md](LICENSING.md)**
for the full open-core model and how enforcement returns later.

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
