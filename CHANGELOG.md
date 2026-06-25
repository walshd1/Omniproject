# Changelog

All notable changes to OmniProject are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from 1.0.0.

## [Unreleased]

## [0.4.0] — 2026-06-25

A **modelling, history & test-maturity** release. No breaking API changes. It adds
a stateless **Exploration** workspace (snapshots → trends, a What-If sandbox, and
cross-system dependency links by hash), an opt-in **time-travel** preview, and
comprehensive **test suites with enforced CI coverage gates** where the SPA had
none — plus a 36-finding security pass. Every new surface is honestly tagged
**Stable / Beta / Experimental**, and it all stays **broker-agnostic, above the
seam**.

> **Maturity legend.** **Stable** = tested and production-intended. **Beta** =
> functional and tested but new and not yet hardened by real-world use.
> **Experimental** = complete and tested *at the seam/contract*, but the
> end-to-end path is unproven against real external systems — treat as a preview.

### Added

- **Comprehensive automated test suites + enforced coverage gates** (**Stable**).
  A new SPA test suite (Vitest + React Testing Library + jsdom, ~400 tests) where
  there was none, plus a larger gateway suite (~240 tests). CI now enforces
  coverage ratchets on both (`c8` ~84% gateway lines; Vitest v8 ~88% SPA lines).
  *Honest caveats:* SPA **function** coverage is ~64% (many inline handlers
  aren't individually invoked); several flows are render-tested, not
  interaction-tested (drag-drop optimistic moves, full pages); the axe-core a11y
  job covers the core routes only. See [docs/TESTING.md](docs/TESTING.md).
- **Exploration mode (`/explore`)** (**Beta**) — a deliberately distinct, "NOT
  LIVE DATA" surface for modelling, kept separate from the live app so a modelled
  or historical figure can't be mistaken for production. All of the following are
  **client-side and session-volatile** (the gateway stays stateless and
  zero-data-at-rest); you **download to keep** or work is discarded at session
  end. See [docs/EXPLORATION.md](docs/EXPLORATION.md):
  - **Portfolio snapshots → trends** — capture the live read-model at 1..N points,
    export/import a JSON bundle for durable multi-month trends, badged `captured`.
  - **Auto-snapshot schedule** — capture on an interval until an end date/time.
    *Limitation:* runs only while the tab is open (durable overnight cadence is
    the n8n historian's job).
  - **What-If sandbox** — a volatile fork of the portfolio with coarse
    completion/schedule/budget/blocker levers and baseline-vs-scenario deltas;
    can be based on **any captured snapshot**; "capture as snapshot" feeds trends.
    *Limitation:* portfolio-level, coarse levers — a modelling aid, not a planner.
  - **Cross-system dependency links by hash** — store **two SHA-256 fingerprints
    + minimal refs only** (never content; guarded by an anti-creep test), with
    live drift detection. *Limitation:* drift recomputes only for endpoints whose
    projects are currently loaded.
- **Time-travel** (**Experimental**) — an opt-in, gated history/replay feature.
  The contract, the admin-only + SSRF-validated + warranty-acknowledged
  **logging-sync** opt-in, the `timeTravel` capability flag, the `Broker.replay`
  method, and the gated `GET /history/replay` are complete and tested *at the
  seam*. **Unproven end-to-end:** `DemoBroker.replay` returns synthesised `sample`
  data, and the n8n historian/replay blueprint
  ([omniproject-time-travel.json](artifacts/n8n-blueprints/omniproject-time-travel.json))
  is a **template** (`active: false`) — there is no integration test against a
  live logging server yet. Forward time-travel is a `projected` model, never fact.
  Off by default. See [docs/TIME-TRAVEL.md](docs/TIME-TRAVEL.md).

### Security

- **36-finding forensic review fixed** (**Stable**) — incl. a critical
  production fail-fast on a default/empty `SESSION_SECRET`, a contributor gate on
  `POST /broker/command`, an SSRF guard on admin-set outbound URLs (incl. the
  IPv4-mapped-IPv6 metadata bypass), and no longer leaking upstream backend
  bodies in error messages. All independently re-verified.
- **`GET /settings` no longer leaks webhook signing secrets** (**Stable**) —
  the read endpoint (reachable by any authenticated session, including read-only
  API tokens) now masks webhook secrets. *Known limitation:* the endpoint still
  returns non-secret config (broker/issuer/logging-sync URLs) to any authenticated
  session; tightening that to admin-only is a follow-up.

### Changed

- **Opt-in state-history egress ("logging sync")** (**Experimental**) — off by
  default; admin-only; the destination URL is SSRF-validated; enabling **requires
  an explicit acknowledgement that egressed data leaves OmniProject's warranty**
  (the same trust class as the OData/Power-BI feeds). This is the single
  deliberate relaxation of the "nothing leaves" posture; OmniProject still stores
  nothing itself.

### Notes on architecture

- All of the above stays **broker-agnostic and above the seam**: the new
  `replay` operation is on the `Broker` interface, n8n specifics remain confined
  to `N8nBroker`, and the architecture-guard, broker-conformance and
  contract-coverage tests all pass.

## [0.3.0] — 2026-06-25

A **quality, hardening, and user-experience** release. No breaking API changes;
the focus is making OmniProject confident to run with real data, pleasant to use,
and provably backend-agnostic.

### Added
- **Comprehensive automated test suite** across five pillars — technical
  completeness, security, accessibility, UX flows, and full regression. Real
  HTTP-level security tests (401 unauthenticated, RBAC 403, read-only API tokens,
  security headers), full `Broker`-contract conformance, an OpenAPI path-coverage
  guard, an **axe-core accessibility CI job**, and a one-command
  `pnpm test:regression`. See [docs/TESTING.md](docs/TESTING.md) and
  [docs/RELEASE.md](docs/RELEASE.md).
- **Keyboard-shortcuts help** (`?`), a complete command palette (all nav targets +
  project quick-jump + shortcuts), and **breadcrumbs** on project/programme detail.
- **Undo** on board issue-move and issue-delete.
- **Deploy-artifact CI guards** so the deploy files can't silently drift again.
  A `deploy-guard` unit test fails CI if a removed env name (e.g.
  `N8N_WEBHOOK_URL`) resurfaces, if a deploy file stops wiring `BROKER_URL`, or if
  a required `${VAR:?}` in compose isn't documented in `.env.example`. A new
  `deploy-lint` CI job validates both compose files (`docker compose config`) and
  the k8s manifest (`kubeconform`). Added `.github/dependabot.yml` to keep image
  pins and CI actions fresh.

### Changed
- **User-experience overhaul (3 rounds).** Query failures now show a clear error
  with **Retry** instead of a blank "empty" screen; a **React error boundary**
  replaces white-screens; **first-run empty states** guide new users to Setup;
  **destructive actions** (promote-to-prod, rollbacks, deletes, config restore) now
  **confirm**; **inline form validation** replaces toast-only errors; the **active
  project persists** across reloads; and the app is now **responsive** (the sidebar
  collapses into a drawer on small screens). All preserving RBAC and accessibility.
- **Accessibility pass (WCAG 2.1 AA).** Skip link, per-route focus + page title,
  keyboard-operable lists/sort/menus, a focus-trapped command palette, announced
  notifications, and reduced-motion + contrast fixes — verified by the axe-core CI
  job (0 violations on the core routes).
- **Faster initial load.** Route-level code splitting + vendor chunking drop the
  initial JS from one ~977 kB bundle to a ~137 kB entry (the charting library is
  deferred to report routes), with cached cross-navigation (no refetch jank) and
  optimistic board moves.
- **More backend-agnostic.** OmniProject is designed to sit above whichever PM
  tools you run; this removes assumptions that leaked one tool's schema:
  - **Issue `status` is now an open string** in the API contract (was frozen to
    one backend's six states), so a backend with different states is no longer
    rejected on write or mis-bucketed on read. The conventional buckets remain the
    documented default; the board derives columns from the data, and unknown
    status/priority values degrade gracefully.
  - **Neutralised tool-specific copy**: the page/social meta tags no longer name
    two specific tools, and the demo dataset now spans several backends
    (Jira/OpenProject/GitHub/Azure DevOps) to show federation.
- **Hardened the deploy stack** (`docker-compose.standalone.yml`,
  `docker-compose.enterprise.yml`, `k8s-enterprise-manifest.yaml`). Pinned every
  image to a verified tag (no `:latest`); fail-fast required secrets (`${VAR:?}`,
  no more `changeme` defaults); healthchecks on every service with health-gated
  startup ordering; dropped the deprecated `N8N_BASIC_AUTH_*` (n8n uses
  owner-account setup now). The standalone stack now serves **real TLS for
  `*.local`** via mkcert + a Traefik file provider (ACME can't issue for `.local`),
  with the OIDC issuer on `https://authentik.local` resolved through Traefik
  network aliases (no host hairpin), and the Traefik dashboard moved behind
  basicauth instead of the open `:8080`. New bootstrap guide:
  [docs/DEPLOY-LOCAL.md](docs/DEPLOY-LOCAL.md).
- **Deploy hardening, round 2** (review-driven). Container hardening on the
  compose services (`no-new-privileges`, dropped capabilities + read-only rootfs
  on the stateless shell) and memory limits on the standalone stack; the
  enterprise n8n port is bound to loopback. On Kubernetes: pod/container
  `securityContext` (run-as-non-root, drop ALL caps, seccomp, read-only rootfs on
  the shell), default-deny + scoped `NetworkPolicy`s, `automountServiceAccountToken:
  false`, `startupProbe`s, and `ingressClassName` replacing the deprecated
  annotation.

### Security
- **Baseline security headers** on every response (`X-Content-Type-Options:
  nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and
  HSTS in production) — previously absent at the gateway.

### Fixed
- **Deploy files set the removed `N8N_WEBHOOK_URL`** — renamed to `BROKER_URL`
  across all three deploy artifacts. As written they silently ignored the broker
  endpoint and ran in demo mode after 0.2.0. Upgraders: rename the var in your
  deployment env/config.
- **k8s template shipped a real SSE bug** — the omni-shell Deployment defaulted to
  `replicas: 2`, but real-time notification fan-out is in-process, so a second
  replica dropped ~half of notifications. Defaulted to `replicas: 1` with a
  documented Redis-bus scale-out path.
- **k8s Secret shipped a usable `SESSION_SECRET` placeholder** — `kubectl apply`
  produced a running cluster signing sessions with a public secret. The Secret now
  ships empty (empty `SESSION_SECRET` → the gateway refuses to boot) with an
  out-of-band `kubectl create secret` recipe; the public n8n Ingress route was
  removed (n8n stays ClusterIP-only).
- **Obsolete Authentik Redis** — removed the `authentik-redis` service, volume,
  env, and health-gates from the standalone stack: Authentik dropped its Redis
  dependency in 2025.10 (moved to PostgreSQL), so the pinned `2026.5.x` never used
  it.
- **`.env` could leak into the image** — `.dockerignore` now excludes
  `.env`/`*.pem`/`*.key`/`certs` (the Dockerfile does `COPY . .`).

## [0.2.0] — 2026-06-24

**Decoupling from n8n.** Early feedback on the 0.1.0 launch kept landing on one
worry: *"isn't this just an n8n front-end — what happens to my data if n8n goes
away?"* This release answers it structurally. n8n is still the only broker that
ships, and the wire contract is byte-for-byte unchanged — but the codebase is now
*incapable of knowing the broker is n8n* above a single seam. If n8n is ever
superseded, you implement one class and nothing else moves. The public surface is
renamed to match (no more n8n in the API, env, or settings you touch).

### Removed (BREAKING)
- **The n8n-named public surface is gone — use the canonical broker names.**
  Pre-1.0 cleanup: `POST /api/n8n-proxy` → `POST /api/broker/command`;
  `Settings.n8nWebhookUrl` → `brokerUrl`; `N8N_WEBHOOK_URL` env → `BROKER_URL`;
  and `GET /api/setup/status.n8n` → `.broker` (`{ configured, urlSet }`). If you
  ran 0.1.0, update your `.env` (rename `N8N_WEBHOOK_URL` to `BROKER_URL`), any
  external API clients, and saved config snapshots accordingly.

### Changed
- **Broker boundary extraction.** The gateway now talks to a single `Broker`
  interface in its own domain vocabulary instead of calling n8n directly. n8n is
  the first/only implementation (`N8nBroker`); demo mode is a second
  (`DemoBroker`) rather than a parallel code path. All n8n specifics are confined
  to one adapter, and an architecture-guard test fails CI if any n8n-ism leaks
  above the seam — so the data path is structurally incapable of knowing the
  broker is n8n. Behaviour-preserving: same API surface, same n8n wire contract,
  same demo experience. See [docs/BROKER.md](docs/BROKER.md) and
  [ADR 0001](docs/adr/0001-broker-boundary.md).

## [0.1.0] — 2026-06-24

First public release. A stateless program-management overlay over headless PM
backends, with n8n as the exclusive data broker.

### Added

- **Overlay core** — stateless gateway (Express) + SPA (React 19), federating
  projects/issues/activity from any backend n8n can reach. Persists no project
  data; reads and writes are brokered through a single n8n webhook.
- **Programmes** — optional grouping of projects with programme-wide rollup and
  drill-down.
- **Identity & RBAC** — OIDC relying party (Auth Code + PKCE) with ID-token JWKS
  verification; viewer/contributor/manager/admin roles mapped from IdP claims;
  read-only API tokens for BI clients; demo mode when no IdP is set.
- **Enterprise backends** — declarative manifests + an n8n workflow generator
  for Jira, OpenProject, GitHub, GitLab, Azure DevOps, ServiceNow, Asana,
  Monday, Trello, Wrike, ClickUp, and the large ERPs (SAP, Primavera, Dynamics
  365, MS Project).
- **Reporting & exports** — portfolio health (RAG/variance), EVM, resource and
  progress views; CSV/XLSX/PDF/Markdown/JSON exports; OData v4 read service and a
  Prometheus `/metrics` endpoint for SAP/Power BI/Grafana.
- **Real-time** — SSE notifications with a pluggable in-process/Redis fan-out bus.
- **Internationalisation** — en/fr/de/es with multi-currency formatting.
- **Operations** — configurable action audit (off/writes/all, optional NDJSON
  sink), config snapshots, named environments with versioned rollback, and a
  stateful developer mode (non-production only) with a debug bundle.
- **Premium overlay (licensed)** — white-label branding, company-nomenclature
  label overrides, outbound webhooks, and enterprise workflow generation, gated
  by a time-limited Ed25519-signed licence key (`402` when unlicensed).
- **Monetisation** — Stripe and Gumroad webhooks that verify the purchase, mint a
  signed licence, and hand it to an n8n fulfilment workflow that emails the buyer
  their key. Importable fulfilment blueprint included.

### Security

- Trust-boundary documentation, identity-spoofing protection on the n8n proxy,
  optimistic concurrency, idempotency + loop-guard, rate limiting, and pino
  secret redaction. See [SECURITY.md](SECURITY.md).

### Licensing

- Core licensed under **Apache-2.0**; premium components under the
  **OmniProject Premium License**. Provided **as is, without warranty**. See
  [LICENSING.md](LICENSING.md).

[Unreleased]: https://github.com/walshd1/Omniproject/compare/0.4.0...HEAD
[0.4.0]: https://github.com/walshd1/Omniproject/compare/0.3.0...0.4.0
[0.3.0]: https://github.com/walshd1/Omniproject/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/walshd1/Omniproject/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/walshd1/Omniproject/releases/tag/0.1.0
