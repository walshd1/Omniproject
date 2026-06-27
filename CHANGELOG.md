# Changelog

All notable changes to OmniProject are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from 1.0.0.

## [Unreleased]

### Added

- **Rich graph + map rendering (dependency-free SVG)** — the `graph` and `map`
  panels now render real visuals, not just the accessible summary: `graph` draws a
  node-link diagram with a circular layout; `map` plots points via an
  equirectangular projection onto an SVG world grid. Both are dependency-free (no
  D3/Leaflet) and make NO external tile calls — fitting the no-egress ethos — and
  keep an accessible (screen-reader) list alongside the visual.
- **Per-kind broker dispatch — heterogeneous brokers, actually routed** — the
  per-kind routing *decision* (`brokerForCommand`) is now a real *dispatch*. Because
  every broker platform speaks the same HTTP contract, routing a command to a kind is
  binding the one HTTP adapter to that kind's endpoint: `BROKER_ENDPOINTS` declares
  per-kind URLs (e.g. `n8n=…,node-red=…`), `endpointsForKind` resolves them, and
  `routeBrokerCall(intent, fn)` binds the call to the selected kind's endpoint for its
  scope via an `AsyncLocalStorage` override at the `webhookPool()` chokepoint — so no
  adapter method is threaded with it and concurrent requests never bleed endpoints. A
  kind with no declared endpoint falls back to `BROKER_URL` (single-broker deployments
  unchanged). This closes the gap flagged in #41/#42: n8n and Node-RED can now each be
  dispatched to their own endpoint over the uniform contract.
- **Per-user accessibility look-and-feel override** — a personal, client-side overlay
  layered over the company branding: text size (0.85–1.5×), high contrast (underlined
  links + thick focus rings), and reduced motion, in the Settings → Accessibility
  panel. It lives in `localStorage` only — nothing is sent to the server, and
  clearing it reverts to the company look — fully in keeping with the stateless,
  nothing-at-rest ethos (the company config is untouched; this is a personal layer).
  Corrupt/missing storage falls back to company defaults, never an error.
- **Graph + map visual primitives (panel kinds)** — two new `PanelKind`s registered
  in the ScreenRenderer panel registry, so they're JSON-composable like every other
  panel and capability-gated. `graph` renders a network/dependency graph from
  `config: { nodes, edges }` (edges typically from `dependsOn`/relationship fields);
  `map` renders geo-tagged entities from `config: { points }`. Both ship the
  **accessible data view** today (counts + a readable edge / location list) so they're
  usable immediately; the rich force-directed (D3) graph and tile-map (Leaflet)
  rendering slot in behind the same components + config — the noted remainder.
- **Cross-backend entity resolution (stateless)** — helpers for reconciling the SAME
  real-world entity appearing in more than one backend (a person who is a Jira
  assignee AND a Salesforce contact). `dedupeEntities(records, keyFn, mergeFn?)` MERGES
  records that share a DETERMINISTIC key (safe to auto-apply; keyless records never
  merge); `matchCandidates(records, matchers)` SURFACES likely-same records (same
  normalised email/name) as CANDIDATES for human confirmation — never auto-merged, so
  a fuzzy collision can't silently corrupt a view. Pure + stateless: no customer data
  is held; a confirmed mapping would persist as JSON in the config dir (the truth
  stays in the backends). `GET /api/setup/entity-resolution/preview` demonstrates both
  over an illustrative sample.
- **Per-kind broker command routing (decision layer)** — `brokerForCommand(intent)`
  chooses which connected broker KIND should serve a command given what it needs
  (`transport` and/or `capability`), built on the multi-broker registry. The rule:
  keep the PRIMARY (the live data/command hop) whenever it qualifies — heterogeneous
  fan-out is the exception, not the default — else the first eligible connected
  broker, else fall back to the primary. Honest scope: this is the routing DECISION;
  actual dispatch still goes through `getBroker()` (one concrete adapter + demo), so
  routing a command to a genuinely different connected platform additionally needs
  per-kind adapter instances bound to each endpoint — that's the remaining work. The
  decision is now explicit + tested, ready for those adapters.

- **Node-RED broker — with an importable flow you can truly test against** (**Stable**)
  — a seventh reference broker, added as a single JSON drop
  (`vendors/brokers/node-red.json`) — the architecture's promise in action. Node-RED
  is open-source and self-hosted, and its `HTTP In → HTTP Response` flow answers the
  read-through contract **synchronously**, so it's a genuine data hop (synchronous,
  self-hostable, inbound + outbound events; no managed per-connector auth — you wire
  credentials yourself). A free, self-hostable alternative to n8n. Ships an
  **importable flow** (`broker/templates/node-red-flow.json` + guide) that answers the
  verify handshake + capabilities out of the box — deploy it, point `BROKER_URL` at
  it, and you're exercising OmniProject against a **real external broker**, not just
  the in-memory sidecar. A test guards the flow JSON + its binding so it can't rot.
- **Methodology is a cross-plane derived grouping (presets across reports + screens)**
  (**Stable**) — reports and screens now carry a `methodologies` tag like views, so a
  methodology spans every renderable plane. `reportsForMethodology(id)` /
  `screensForMethodology(id)` are the report/screen analogues of
  `viewsForMethodology`; `allMethodologyTags()` is the cross-plane picker list (every
  defined methodology ∪ any tag any asset declares). `GET /api/setup/methodology-preset/:id`
  returns everything a methodology activates across views + reports + screens — so
  "click Kanban" surfaces the board, cumulative-flow report and all. Methodology packs
  (#36) now include the tagged reports + screens automatically. A methodology is fully
  a DERIVED grouping over tagged assets, not a standalone plane.
- **Methodology packs — a methodology is a portable bundle** (**Stable**) — now that
  every plane is JSON, a methodology is the DERIVED grouping of all assets carrying
  its tag. `methodologyPack(id)` collects a methodology's definition + its tagged
  views, notification routes and reference ruleset into one `MethodologyPack`;
  `GET /api/setup/methodology-pack/:id` (admin) downloads it as a JSON bundle an
  operator can drop into another deployment's config dir to reproduce the same look +
  rules. Neutral ("*") assets are excluded (they ship regardless). Reports + screens
  don't carry methodology tags yet (the asset-selectability work), so they're not in
  a pack today.

### Changed

- **Methodologies are JSON-defined** — the last hand-written catalogue array moves to
  JSON. Each methodology (Scrum, Kanban, Scrumban, Waterfall, PRINCE2, SAFe) is
  authored under `assets/methodologies/<id>.json` (validated against a JSON Schema,
  embedded by `gen-methodologies`, drift-guarded in CI, overlayable per deployment);
  the catalogue sources `METHODOLOGIES` from the generated array sorted by `order`.
  Every catalogue plane — backends, brokers, outputs, notifications, fields, views,
  reports, screens, methodologies — is now JSON over generic code. This is also the
  groundwork for importable methodology **packs**.
- **AI providers + column coercion are registry-driven** — two more bespoke
  `switch` statements become registries. `ai.ts` now holds an `AI_PROVIDERS` registry
  (`provider → { status, chat }`), so the AI status + chat paths route by lookup and
  adding a provider is one entry (a guard test asserts the registry covers every
  non-`none` provider). `column-mapper.ts`'s `coerceValue` switch becomes a
  `FieldType → coercer` registry. Both behaviour-identical.
- **Action dispatch is registry-driven, not switch-driven** — the two hand-written
  `switch (action)` statements become handler registries keyed by action. The
  broker-core binding switch is now `BINDING_ACTIONS` (the canonical binding-action
  registry — the single source of the action vocabulary every transport routes), and
  the MCP executor is now a handler registry tied to its declared `MCP_TOOLS`. A
  guard test asserts the MCP handlers and the declared tools match exactly (a tool
  can never ship without an executor, or vice versa). The two action sets overlap but
  neither is a subset — `list_reports`/`list_screens` are cross-plane catalogue
  actions, not backend binding calls — so they stay two registries, honestly. The
  binding behaviour is identical (conformance/blueprint/smoke suites unchanged).
- **Reports + screens are JSON-defined** — the last two renderable planes move from
  hand-written TypeScript arrays to JSON, completing what the board views started.
  Each report (`assets/reports/<id>.json`) and screen (`assets/screens/<id>.json`) is
  validated against a JSON Schema, embedded by `gen-reports` / `gen-screens` (the
  shared gen-registry engine), drift-guarded in CI and overlayable per deployment.
  The catalogues now source `REPORTS` / `SCREENS` from the generated arrays (sorted
  by an explicit `order`, so display order is preserved) and keep their types +
  capability-gating functions. All three renderable planes — views, reports, screens
  — are now JSON over generic code. No behavioural change.
- **Canonical field vocabulary is JSON, below the seam** — the ~114-field canonical
  registry was hand-written TypeScript stranded in the gateway
  (`artifacts/api-server/.../field-registry.ts`), even though the contract generator
  and the gateway both read it. The field DATA + its descriptor types now live in
  the catalogue (`field-vocabulary.ts`), authored as a single JSON array
  (`assets/fields.json`), validated element-by-element against a JSON Schema, embedded
  by `gen-fields`, and **drift-guarded in CI** — the same data-not-code pattern as
  vendors/views. Extending the vocabulary is now a JSON edit. The gateway's
  `field-registry.ts` re-exports it (so every existing import path is unchanged) and
  keeps the gateway-only reconcile/validate behaviour and the `EnumeratedField` type
  above the seam. No behavioural change — the contract is byte-identical.

### Added

- **Canonical notification-kind registry** (**Stable**) — notification kinds
  (`assignment`, `due_soon`, `blocker`, `incident`, …) were bare strings scattered
  across demo data, the routing JSON and the bell. They're now one registry
  (`notification-kinds.ts`) — each kind tagged with a severity (`info` | `warning` |
  `critical`) — the notification-plane analogue of the canonical status/priority
  vocabularies. The ingest now stamps each event with its kind's severity (so a
  channel can page on `critical`, digest on `info`); a guard test fails CI if a
  routing rule matches a kind the registry doesn't know (the kind analogue of the
  "real channel" guard); `GET /api/setup/notification-kinds` surfaces the vocabulary.

### Changed

- **Config export uses a renderer registry, not a switch** — `buildConfigExport`
  now resolves its deploy-format renderer (`env` / `compose` / `k8s`) from a
  `Record<format, renderer>` map instead of a `switch`, matching the registry idiom
  the data EXPORTERS and setup-status SECTIONS already use (adding a format is one
  entry). (The data-export `EXPORTERS` was already a registry; `xlsx` stays a
  deliberate exception — a multi-sheet workbook over all datasets.)

- **The broker plane is synchronous-only; async platforms move to outputs** —
  a platform that can't answer the binding in the SAME HTTP call isn't a broker, so
  Apache Airflow (the only `synchronous: false` entry) leaves the broker plane. The
  broker schema now enforces `synchronous: true` (a `synchronous` of `false` fails
  generation) and a guard test backs the invariant — the broker plane IS the
  synchronous data-hop plane. Airflow is re-homed in the **outputs** plane as a new
  `batch-egress` kind (`vendors/outputs/airflow.json`): a scheduled DAG that reads
  the OData/BI feeds and lands data downstream, or consumes outbound events to
  trigger batch work — the same honest limit as Zapier/IFTTT (which were already
  event-edge consumers, not brokers). The `dag-template` broker build method is
  removed. `GET /api/setup/outputs` now lists Airflow; `GET /api/setup/brokers` no
  longer does.

### Added

- **Generic notification dispatch — JSON routing above the seam** (**Stable**) —
  which event kinds go to which delivery channels is now a config decision, not
  code. Routes are authored as JSON (`assets/notification-routes/<id>.json`,
  validated + embedded by `gen-notification-routes`, drift-guarded in CI, overlayable
  per deployment) and a generic engine — `routeNotification(event, isChannelAvailable)`
  — turns an event into the de-duplicated set of **delivery intents**
  (`{route, channel, audience}`). The seam line is exact: the engine only DECIDES
  targets (dispatch); DELIVERY — posting to Slack, paging PagerDuty, sending the
  email — stays BELOW the seam (the broker workflow reads `dispatch[].channel`). On
  `POST /api/notifications/ingest` the routing decision now rides along with the
  outbound `notification` event and is returned in the response; `GET
  /api/setup/notification-routes` surfaces the rules. A guard test (the
  notification-plane analogue of the incompatibility guard) fails CI if a route names
  a channel that isn't in the catalogue, so a dangling channel can't silently never
  deliver. Each route carries a `methodologies` tag, so a methodology pack can ship
  its own routing.
- **Multi-broker router — many broker kinds connected at once** (**Stable**) — a
  registry above the seam (`broker/registry.ts`) that knows which broker KINDS are
  connected to a deployment, so the capability resolver can union what they
  collectively support. Reality of the seam: OmniProject speaks ONE HTTP contract to
  every broker platform, so "many brokers at once" isn't many gateway adapters — it's
  several platforms wired below the seam (e.g. n8n for the live data hop + Make for
  outbound events). The connected set = the active broker (PRIMARY, the live
  data/command hop) ∪ any kinds declared in **`BROKER_KINDS`** (catalogue ids;
  unknown ids dropped so a typo can't surface phantom capabilities). `resolveSupport`
  now unions broker capabilities across `connectedBrokerKinds()` instead of the
  single active kind, and `brokersSupporting(capabilityKey)` is the routing
  primitive ("which connected kind can deliver `eventsOutbound`?"). `GET
  /api/setup/brokers?connected=1` surfaces the wired set. The live data/command hop
  remains the configured synchronous broker (`getBroker()`); this widens *capability
  surfacing* across kinds, not per-kind command routing.
- **Compatibility model: one predicate, a two-plane resolver + an incompatibility
  guard** (**Stable**) — how we know which of anything to surface based on what the
  broker(s) AND backend(s) support, unified.
  - **One predicate.** Whether any surfaceable asset (report, screen, view, panel)
    appears is now a single rule, `isCapabilityMet(requirement, support)`, over a
    flat capability-key → boolean support set. `availableReports` /
    `availableScreens` call it instead of inlining the check.
  - **Two-plane key space.** The support set spans BOTH planes: the backend domains
    (`CAPABILITY_DOMAINS`) plus the broker capability keys (the new
    `BROKER_CAPABILITY_KEYS` — `synchronous`, `selfHostable`, `managedAuth`,
    `eventsInbound`, `eventsOutbound`), so an asset can require what a backend OR a
    broker supports.
  - **The resolver.** `resolveSupport(req)` folds the resolved backend domains and
    the connected broker(s)' capability keys into ONE map via `unionSupport` (OR
    across maps, taking only `true` flags). Broker support comes from the catalogue
    (`brokerSupport` / `brokerSupportUnion`, OR-unioned across connected brokers — a
    demo broker simulates the full reference broker, so it enables every broker key,
    mirroring demo's all-domains-on). The `/setup/reports`, `/setup/screens` routes
    and the MCP `list_reports` / `list_screens` tools now gate on this unified set.
  - **The guard.** A CI **incompatibility guard** (`compatibility-guard.test.ts`)
    asserts every shipped asset's declared requirement names a REAL capability — a
    dangling/typo'd requirement (which would silently hide an asset forever, or
    surface it unconditionally) fails the build — and that reports/screens always
    DECLARE their requirement (even if `null`).

  Additive; the connected-broker list is single-kind today — the multi-broker router
  (many broker kinds at once) widens it next, and `brokerSupportUnion` already ORs
  across however many it's given.
- **ScreenRenderer hosts the real methodology views as panels** (**Beta**) — a
  `view` panel kind bridges the generic renderer to the existing heavy view
  components (Kanban board, Gantt, Scrum, PRINCE2, RAID, List) via the shared
  `VIEW_COMPONENTS` registry. A screen can now embed any view as a panel (config:
  `{ view, projectId }`); the components are reused unchanged and self-fetch their
  data, so the renderer needs no data plumbing — the payoff of writing the board /
  Gantt once. Still additive (no page migrated yet).
- **Generic ScreenRenderer + panel registry** (**Beta**) — one renderer that lays a
  screen's panels onto a grid and delegates each to its panel renderer by `kind`, so
  screens, views and reports all render from JSON through ONE component (each widget
  kind written once). A screen is `{ panels[] }`; a panel is `{ kind, config }`.
  Ships the self-contained leaf kinds (metric, text, table, list); the complex kinds
  (board, chart, timeline, register) get registered as the existing components are
  wrapped as panels next. Panels are individually selectable; a `methodology` preset
  activates the panels tagged with it (per-context or throughout); capability gating
  hides a panel whose backend domain isn't fed; an unknown kind degrades to a
  placeholder. Additive — nothing migrated yet.
- **Board views are JSON-defined + methodology-tagged** (**Stable**) — the first of
  the renderable planes to move from hand-written TypeScript to JSON. Each view
  (Kanban, Scrum, Gantt, PRINCE2, RAID, List) is authored under
  `lib/backend-catalogue/assets/views/<id>.json` (validated by a JSON Schema,
  embedded by `gen-views`, drift-guarded in CI) and the SPA sources its view list
  from the catalogue (single source — no hand-kept copy). Each view carries a
  **`methodologies` tag**; a methodology is now the DERIVED set of assets sharing a
  tag (like a programme is derived from project membership), surfaced at
  `GET /api/setup/views?methodology=<tag>`. The bespoke renderers are unchanged —
  the generic `ViewBuilder` and reports/screens follow next.
- **"Lock this config" export — read ≡ dump** (**Stable**) — `GET
  /api/setup/config-bundle` (admin) downloads the current effective config as the
  EXACT folder-of-JSON the loader reads: `config.json` + the deployment's overlay
  `vendors/<plane>/*.json` + `rulesets/field-rules.json` & `rule-modes.json`, zipped.
  The customer keeps the bundle and mounts it as `OMNI_CONFIG_DIR` to persist their
  look-and-feel; the gateway stores nothing. The config-dir loader now also reads
  `rulesets/` (governance ruleset, restrict-only) and inventories `artifacts/`
  (things generated against our reference). The bundle is **config only** — never
  customer data (enforced by the config-purity guard).
- **Per-vendor vocab maps + one-click nomenclature** (**Stable**) — a backend's
  vendor JSON can declare how it names things: a **`nomenclature`** preset (canonical
  term → the vendor's word, e.g. Zendesk "Ticket", ServiceNow "Incident", Trello
  "Card") and a **`statusVocabulary`** (native status → canonical, below the seam).
  `GET /api/labels/presets` lists them; `POST /api/labels/apply-preset` adopts one in
  a click (written through the label-override allow-list) — a shortcut instead of
  re-typing each label. Shipped presets for ~10 vendors.
- **Config-purity guard** (**Stable**) — a test that fails CI if a data-bearing
  entity key (projects/issues/…) ever leaks into the config snapshot. Encodes the
  invariant: config is a folder of JSON; **true customer data is never at rest** in
  OmniProject (it's brokered live), so losing/corrupting the config JSON can't touch
  the data underneath.
- **A deployment's config is a folder of JSON, read at runtime** (**Stable**) — set
  `OMNI_CONFIG_DIR` and the gateway reads it at boot: `vendors/<plane>/*.json` to
  **add or override vendors** (schema-validated, overlaid through the catalogue
  accessors so the override flows everywhere) and `config.json` (a config snapshot)
  for **settings + label tweaks**. Every file is validated against the same schema
  the author designed against; a bad file is logged + skipped, never fatal. The
  gateway holds nothing durable — the JSON on disk is the persistence — so the code
  stays stateless and a deployment is portable as one folder. `GET
  /api/setup/config-dir` (admin) reports what loaded. The JSON-Schema validator now
  lives in the catalogue, shared by `gen-vendors` (build time) and the runtime
  loader, with the schemas embedded for portable validation.

### Changed

- **Two more dispatch points became registries** (**Stable**, internal) — continuing
  the "generic engine + registry" abstraction: the data exporters
  (`routes/export.ts`) now share one `EXPORTERS` registry (format → `{ contentType,
  render }`) with the routes derived from it, so a new single-dataset format is one
  entry (xlsx stays bespoke as a multi-sheet workbook); and `GET /api/setup/status`
  is assembled from a `STATUS_SECTIONS` registry (`lib/setup-status.ts`) so adding a
  subsystem to the diagnostics is a section, not an edit to a growing literal. Both
  behaviour-preserving. (Notification *delivery* was deliberately left below the
  broker seam — see the generic-dispatch work for the seam-correct treatment.)
- **Vendor-overlay merge is memoised + perf-guarded** (**Stable**, internal) — the
  catalogue accessors' overlay merge is now cached per plane (invalidated on
  register/clear), so a deployment overlay doesn't rebuild the merged set on every
  call; the no-overlay path stays zero-copy. A new perf guard proves the
  memoisation (reference identity) and that 100k catalogue lookups stay well under a
  second, so a future regression trips CI. (Context: the config/asset JSON is
  embedded at build time and read once at boot — never on the request path — so this
  is the one place the "everything is JSON" model could have added per-call cost,
  now closed.)
- **Two more patterns abstracted into registries** (**Stable**, internal) — applying
  the same "generic engine + registry of handlers" shape as the ScreenRenderer:
  (A) `gen-vendors` and `gen-views` now share one `gen-registry` engine (read JSON →
  validate → emit typed module), so a new asset plane is a descriptor, not a copied
  generator; (B) the config-directory loader is now a registry of per-subdir loaders
  (vendors / config.json / rulesets / artifacts), so adding `views/`/`screens/` to
  the config folder is a one-line registration. Behaviour-preserving: byte-identical
  generated output and unchanged config-load behaviour.
- **Renamed `n8n-backends.ts` → `backend-catalogue.ts`** — the file holds the
  broker-neutral backend catalogue plus the *reference* n8n binding; the old name
  wrongly implied the backends themselves were n8n-coupled. Now parallel to
  `broker-catalogue` / `notification-catalogue` / `output-catalogue`. No API change.
- **Vendor definitions are now JSON files in a directory** (**Stable**) — every
  vendor (backend, broker, notification, output) is authored as one JSON file under
  `lib/backend-catalogue/vendors/<plane>/<id>.json`, validated against a per-plane
  JSON Schema. To add a vendor you design + verify the JSON and drop it in — no
  TypeScript. A `gen-vendors` step validates every file and embeds the result into a
  portable, type-checked `vendors.generated.ts` (so the catalogue still ships no
  runtime files and works in the browser), kept honest by a CI drift guard. Pure
  form change: the 64 shipped vendors are byte-for-byte the same data. See
  [lib/backend-catalogue/vendors/README.md](lib/backend-catalogue/vendors/README.md).

### Added

- **Canonical value vocabularies below the seam** (**Stable**) — the cross-backend
  meanings the gateway reasons about (status lifecycle, priority, RAG) now live in
  one typed module (`broker/vocabulary.ts`) instead of being hard-coded as `"done"`
  / `GREEN`/`AMBER`/`RED` in neutral code. Wire fields stay open strings; a backend
  can declare a typed **`StatusVocabulary`** to map its dialect to canonical
  statuses as *data*, so a vendor's status names are abstracted below the seam
  rather than branched on in code. A new **vocabulary guard** test keeps these
  meanings in their one home, the same way the broker guard keeps vendor names below
  the seam. `programmes`, the Prometheus RAG gauge and the demo/reference brokers all
  consume the shared module (de-duplicating the RAG/`ragFor`/financial-health logic).
- **Open invitation to audit & pentest** (**Stable**) — a published vulnerability
  disclosure policy with explicit **scope, rules of engagement and safe-harbour**
  terms (test only your own instance; n8n/IdP/backends out of scope; no DoS), plus a
  machine-readable **`/.well-known/security.txt`** (RFC 9116) served by the gateway.
  See [SECURITY.md](SECURITY.md).

## [0.6.0] — 2026-06-27

A **governance, ingestion, extensibility & readability** release. No breaking API
changes (all additive); the RBAC change only tightens the top tiers. Everything
below stays **broker-agnostic, above the seam**, and every new gate is
**restrict-only** or **additive** — no security control was loosened.

### Added

- **Seven integration planes** (**Stable**) — backends, brokers, outputs,
  notifications, methodologies, reports and screens, each a registry in the shared
  `@workspace/backend-catalogue` following one principle: a neutral manifest with
  **capabilities kept separate from tools, linked**. Cross-plane links via
  `alsoProvides`; a `verify-plane` tool keeps every shipped entry honest. See
  [docs/INTEGRATION-PLANES.md](docs/INTEGRATION-PLANES.md) + the per-plane guides in
  [docs/dev/](docs/dev/).
- **Business ruleset engine** (**Stable**) — an extra, PMO-configurable governance
  layer on top of the hard rules. Built-in rules (read-only freeze, no-deletes,
  require assignee/description, schedule-sanity `due-after-start`) plus admin field
  rules ("require an estimate", "cost-centre when billable"). **Restrict-only**: it
  runs after the hard gates and can only deny/warn, never grant. See
  [docs/ops/BUSINESS-RULES.md](docs/ops/BUSINESS-RULES.md).
- **Reference rulesets per methodology** (**Stable**) — curated, named ruleset
  bundles for Scrum, Kanban, Scrumban, Waterfall, PRINCE2 and SAFe, applied by the
  PMO for compliance + completeness (`GET`/`POST /api/admin/ruleset/reference`).
- **PMO role + orthogonal authorities** (**Stable**) — a linear base ladder
  (viewer → contributor → manager) plus two **independent, joinable authorities**:
  **PMO** (business governance) and **admin** (technical config). A pure admin can't
  edit business rules and a pure PMO can't touch technical config; holding both
  grants the union. See [docs/ops/ROLES.md](docs/ops/ROLES.md).
- **Role-mapping editor** (**Stable**) — admin-only, audited `GET`/`PUT
  /api/admin/role-map` to map IdP groups to the fixed roles at runtime. By design a
  *mapping* editor, not a permission creator — it can't invent a role or grant a
  permission, so the RBAC boundary stays statically verifiable.
- **Excel/CSV import + column mapper** (**Stable**) — a pure, tested column →
  canonical-field mapper (exact / synonym / fuzzy) behind `POST /api/import/preview`
  and `/commit`; commit writes through the live backend and runs the business
  ruleset **per row** (import can't bypass governance). See
  [docs/ops/IMPORT.md](docs/ops/IMPORT.md).
- **Admin-gated raw SQL + MongoDB backends** (**Stable**) — for internally-hosted /
  legacy stores. The gateway **never ships raw SQL**: it posts a contract action +
  typed params to a sidecar that owns the parameterised queries + credentials. See
  [docs/ops/DATABASE-BACKENDS.md](docs/ops/DATABASE-BACKENDS.md).
- **Read-only MCP server** (**Stable**) — speak the Model Context Protocol over the
  broker seam; write tools are opt-in (`MCP_WRITE_ENABLED`) and contributor-gated,
  and the same neutral catalogue powers MCP, reports and screens. See
  [docs/MCP.md](docs/MCP.md).
- **More notification channels** (**Stable**) — added **MQTT** (IoT/event-bus),
  **MCP** (agent) and **Notion** alongside the existing channels, via the
  vendor-neutral notification plane. `NotificationKind` gained `iot`/`agent` and the
  delivery transports gained `mqtt`/`mcp`. See
  [docs/dev/PLANE-NOTIFICATIONS.md](docs/dev/PLANE-NOTIFICATIONS.md).
- **More backends** (**Stable / Experimental** per backend) — **Planview**
  (enterprise), **Celoxis**, **LiquidPlanner**, and **Notion** as an output target.
  All vendor specifics stay **below the seam**; the gateway only ever sees the
  neutral contract.
- **Strategic-alignment fields** (**Stable**) — a `strategy` field group (strategic
  goals, KPIs, objectives, strategic theme, value stream, contribution, expected /
  realised benefit), surfaced at **project and programme level** and capability-gated
  to the portfolio domain — so a programme can show which goals and KPIs each thing
  rolls up to.
- **Served, broker-agnostic consumer API** (**Stable**) — `GET /api/openapi.yaml`
  and `GET /api/discovery` expose the gateway's own API (the one above the seam) so
  any client can integrate without knowing the broker. The bundle is generated from
  the spec and drift-guarded in CI.
- **Raw API escape hatch** (**Experimental**) — an **admin-only**, env-gated
  (`RAW_API_ENABLED`, 503 when off), audited last-resort passthrough with a prominent
  health warning, for the rare action no typed route covers. Off by default.
- **Property-based testing in CI** (**Stable**) — a seed-deterministic,
  dependency-free property-test harness (`lib/proptest.ts`, `PROPTEST_SEED` /
  `PROPTEST_RUNS`) for structured edge-case and data-shape verification.
- **Function map** (**Stable**) — [docs/FUNCTION-MAP.md](docs/FUNCTION-MAP.md): a
  generated, one-screen-per-package index of every source file and its exported
  functions, each with the one-line comment from the code. A developer can audit how
  the codebase fits together without reading the long tech docs. Generated by
  `gen-function-map` and kept honest by a CI drift guard.

### Changed

- **Readability pass across the codebase** (**Stable**) — every source file now opens
  with a **title** saying what it does, and every exported function carries a comment
  explaining it, enforced by a new **readability guard** test (the same guard-driven
  approach as the broker/deploy/plane guards) spanning the gateway, the backend
  catalogue and the scripts package. The aim: obvious, human-readable code first,
  with the deep docs as backup.
- **Docs lead with "the broker", not n8n** — the product docs no longer imply you
  *need* n8n. OmniProject is broker-agnostic; **n8n remains the reference broker** and
  is named only where the n8n product itself is the subject (its blueprints, its setup,
  the boundary ADR).

### Architecture invariants (held + tightened)

- **Hard seam — zero exceptions.** No code above the broker seam imports a concrete
  adapter; the one remaining generic-command coupling was moved behind a `brokerCommand`
  seam helper, so the broker-guard now allows **no** adapter imports above the seam.
- **Vendors are never a plane.** A vendor/product only ever appears as a **backend,
  broker, notification or output** — never a new plane; methodologies, reports and
  screens stay vendor-neutral. Encoded as a `vendor` flag on each plane + a
  `VENDOR_PLANES` list and verified by the plane guard.
- **Don't show what no backend supports.** Reports and screens are filtered by the
  resolved (union-across-connected-backends) capability set — if nothing connected
  supports a feature, it isn't surfaced (`?available=1`).
- **Many backends ↔ many brokers, simultaneously.** Confirmed: nothing in the seam
  assumes a single backend or a single broker.

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

[Unreleased]: https://github.com/walshd1/Omniproject/compare/0.6.0...HEAD
[0.6.0]: https://github.com/walshd1/Omniproject/compare/0.4.0...0.6.0
[0.4.0]: https://github.com/walshd1/Omniproject/compare/0.3.0...0.4.0
[0.3.0]: https://github.com/walshd1/Omniproject/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/walshd1/Omniproject/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/walshd1/Omniproject/releases/tag/0.1.0
