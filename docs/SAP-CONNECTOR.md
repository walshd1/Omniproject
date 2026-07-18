# SAP Connector — design (roadmap §4.6)

Status: **⬜ Design.** Not built. This is the read-model + join-key spec for a first-class SAP
connector, so it's ready to build after the config-diff slice (§4.9) lands.

## Intent

SAP S/4HANA is the **system of record** for the project→finance object graph and the general
ledger. OmniProject does **not** replace it, re-post to it, or cache its data at rest. The connector
is a **read adapter** on the existing broker seam (`Broker`, `src/broker/types.ts`) that lets
OmniProject **see and orchestrate over all of SAP's project/portfolio data** — the fast, private layer
on top — with the same zero-at-rest posture as every other backend.

Positioning (from the 2026 SAP/PPM research pass): SAP's project→GL depth (Universal Journal +
event-based revenue recognition) is a genuine moat we can't and shouldn't replicate. Our wedge is
being the modern, brokered, config-portable layer that reaches into SAP and everything else. This
connector is the credibility piece that makes that real.

## "SAP-light" for everyone — not just SAP customers

The read models here (`listWbsElements`, `getWbsFinancials`, …) are **broker methods**, not SAP-specific code.
So the *same* project→WBS→financials capability — a cost-structured view of a project — can be offered to
**any** customer, three ways, all behind the one seam:

1. **SAP** — the ERP connector fronts real S/4HANA data (this doc's main path).
2. **Their backend of choice** — the broker adapter maps whatever they run (Jira/OpenProject/Azure DevOps/…)
   into the WBS/financials read model where the data allows (e.g., epics→WBS, cost fields→financials).
3. **The sidecar store** — for customers with no ERP and no cost data in their tracker, OmniProject's own
   **sidecar SoR** holds an authored/imported WBS + financials (the same JSON-scoped, zero-at-rest sidecar
   pattern the wiki/whiteboard/proofs already use). They author it, or import a CSV/XLSX; we render it.

This is the wedge stated plainly: **the SAP-grade *cost-structure experience*, available to everyone**, with
SAP as the deepest-fidelity source when present and the sidecar/other backends covering the rest — SAP keeps
the ledger; we bring the screens. The demo broker's fixtures already stand in for path 2/3 in tests.

### The mapping layer (looks like SAP, stored in OpenProject/…)

The screen speaks in SEMANTIC fields (`wbs`, `name`, `budget`, `actual`, …). A **WBS field mapping**
(`lib/wbs-mapping`, admin-authored, same idiom as `fieldOverrides`/`column-mapper`) maps each semantic field
to a chosen backend's real field name — e.g. OpenProject `wpId`→`wbs`, `costBudget`→`budget`,
`parentWp`→`parentId`. `applyWbsMapping(sources, mapping, projectId)` is PURE: it projects any backend's records
into the exact `WbsElement`/`WbsFinancials` read model the screen consumes (money-as-strings parsed,
`available = budget − actual − commitment`, WBS level derived from the parent chain). So the SAME JSON screen
renders — and, for a read/write backend or the sidecar, round-trips — whether the data lives in SAP,
OpenProject, another system, or our sidecar. Proven in tests with OpenProject-shaped rows → the identical
model the SAP fixtures produce.

**Per-field (broker, backend) addressing (built).** Every field resolves to **exactly one broker and exactly
one backend** via the shared `lib/field-target` spine (`FieldTarget = { broker, backend, field }`) — the same
composite identity `field-routing`'s `FieldRoute` carries, lifted into a reusable primitive. N backends reached
through N brokers; each field names its single home (1:1:1 — one field, one broker, one backend). A field with
**no home is HOMELESS — a decision surfaced to the admin, never a silent default.** The admin resolves each
homeless field one of three ways: map it to another external backend that has a field for it, point it at our
built-in broker + sidecar backend (the basic self-hosted all-in-one home — a *declared* choice), or remove the
field. The shipped core mappings declare the built-in + sidecar home explicitly, so the all-in-one experience
works out of the box; nothing is ever assumed on the admin's behalf. Homeless fields are surfaced by
`GET …/mapping/:slot` (a `homeless[]` list) and reported by the write routes (written nowhere). In the WBS
mapping this means: the mapping declares a home (`broker`/`backend`) where the WBS
*structure* lives, each cost figure inherits it or routes elsewhere (`{ backend: "sap", field: … }`), and the
route projects per-`(broker,backend)` record buckets joined by the WBS id (`joinField` names the join column in
non-home sources). "Structure in OpenProject, budget from SAP, the rest in our sidecar" is one mapping — proven
in tests.

**First-class Mapping object (built).** A mapping is now a first-class def (`kind: "mapping"`, `lib/mapping`)
authored through the ONE importer (`POST/PUT /api/defs`), sealed + scope-resolved exactly like screens/reports.
It's generic — `fields: { semanticKey → FieldTarget }` — so it routes *any* surface's fields, not just WBS, and
it **subsumes** the org's legacy `fieldRouting` (`mappingFromFieldRoutes` folds it in as the lowest customer
layer, so nothing is lost). The shipped **core** mapping is seeded into the system store as a `mapping` def
("core mappings in JSON in the system store").

**Scope-overridable resolution (built).** `resolveWbsMapping(ctx, slot)` resolves like screens/def-bindings:
core (shipped) → org `fieldRouting` (subsumed) → `org → programme → project → user` mapping defs, **merged
per-field, nearest wins** — a project retargets just `budget` and inherits the rest. Each override is validated
through the importer's sanitiser and lives in its own sealed scope file, so a PM's change is confined to their
project by construction. `GET /projects/:id/wbs/mapping` returns the effective mapping (the admin UI reads it to
show "where each field comes from").

**Sidecar WBS store + write path (built).** `lib/wbs-sidecar` is OmniProject's own zero-at-rest home for WBS
records — the built-in broker's backend, and the basic self-hosted all-in-one model (path 3). Rows are RAW
records so the SAME `applyWbsMapping` projects them. `GET /wbs/cost-rows` serves the sidecar via the resolved
mapping when a project has authored sidecar WBS, and falls back to the external broker's native read models
otherwise — one `{ rows }` shape, either source. `PUT /projects/:id/wbs/:wbsId` writes semantic field values
back through the mapping (`lib/wbs-write`): sidecar-targeted fields land in our sealed store (created on first
save, field-by-field merge after); external-targeted fields are returned as `external` — the broker write
adapters are the remaining slice, so those are reported, never silently dropped. contributor+, project-scope
gated, audited.

**Across the board (built).** The mapping model isn't WBS-only. A generic surface exposes the SAME addressing +
sidecar for ANY slot: `GET /projects/:id/mapping/:slot` (the resolved mapping), `GET …/mapping/:slot/rows`
(sidecar rows projected through it, `{ rows }`), `PUT …/mapping/:slot/:rowId` (write split by target). So a
form / report / custom screen JSON binds a mapped, sidecar-backed table with **no bespoke code** — it just
points `source.url` at `/api/projects/{projectId}/mapping/{slot}/rows` (the generic `{projectId}` templating
already carries it). `lib/mapping` grows the generic `projectMappingRows` + `planMappingWrite`; `lib/mapping-
sidecar` is the per-slot sealed row store; `lib/mapping-resolve` is the scope layering WBS and every generic
slot share. WBS keeps its own richer endpoints (financial roll-ups); it's now one instance of the general model.

**Remaining:** the external broker read/write adapters themselves (reaching a genuinely different
SAP/OpenProject instance per `(broker, backend)` address). The routing decision + the sidecar leg are done;
per-platform adapter instances bound to each endpoint are the last mile (see `broker/registry.ts`).

## Non-goals (what SAP keeps)

- ❄ **The ledger.** Actual postings, settlement, revenue recognition, capitalization — SAP's, never ours.
- ❄ **Copies of financial data at rest.** We hold **references (ids), not values**; we fetch and render live.
- ❄ **Write-back to finance.** No cost postings, no budget commitments, no recognition entries via us.

## What SAP captures — and what we capture as a *read model*

| SAP domain (owned by SAP) | We capture (read/reference) | Join key |
|---|---|---|
| Project def → **WBS** → network activity → milestone tree; system/user status; baselines | structure + status, rendered in our project/plan screens | project id, WBS id |
| **Cost actuals / commitments / budget + availability control / WIP** (ACDOCA) | per-WBS financial roll-ups on our budget/cost views | WBS id, cost object |
| **Event-based revenue recognition / project margin** | recognized / deferred / accrued + margin by project (read) | WBS id |
| Billing plans / milestone billing | billed vs plan | WBS id, billing doc |
| **Timesheet actuals (CATS)**, activity confirmations | utilisation + burn feeding our resource views | WBS id, resource id |
| Procurement: PR / PO / goods receipt / service entry / supplier invoice | committed vs actual spend | WBS id, PO id |
| Portfolio (SAP PPM/RPM): portfolios, buckets, initiatives/items, portfolio financial + capacity plan | portfolio roll-ups + our what-if overlays | portfolio/bucket id |
| Master data: cost centers, profit centers, internal orders, GL/cost elements, company codes, controlling areas, FX rates, employees (HCM/SuccessFactors), customer↔project | resolve names/currency/org for display + joins | the id sets above |

**Capture the join keys first.** The master-data key set is what lets our roll-ups, priority weights,
and (future) portfolio-grounded copilot reason over SAP's numbers without holding them.

## Where it plugs in — the broker seam

The connector is a new `Broker` implementation, `kind: "sap"`, `live: true`. It implements the core
methods (`listProjects`, `listIssues`, …) by mapping SAP objects, plus a set of **OPTIONAL** read
extensions for the finance/project domains. Optional methods degrade exactly like the existing wiki /
whiteboard / task extensions: a backend that doesn't expose a domain simply omits the method and the
corresponding surface answers **501 / empty**, never a crash.

Proposed optional read extensions (names indicative; all `ActorContext`-scoped, capability-gated):

```
// Project structure
listWbsElements?(ctx, projectId): Promise<WbsElement[]>           // WBS tree (parentId nesting)
listNetworkActivities?(ctx, wbsId): Promise<NetworkActivity[]>
listMilestones?(ctx, projectId): Promise<ProjectMilestone[]>

// Financials (READ ONLY — references + numbers, never postings)
getWbsFinancials?(ctx, wbsId): Promise<WbsFinancials>            // actual, commitment, budget, WIP, planned
getProjectRevenue?(ctx, projectId): Promise<RevenueRecognition>  // recognized/deferred/accrued + margin
listBillingPlan?(ctx, projectId): Promise<BillingPlanLine[]>

// Time / procurement (read models)
listTimesheetActuals?(ctx, opts): Promise<TimesheetActual[]>     // CATS postings by WBS/resource
listProcurementCommitments?(ctx, wbsId): Promise<ProcurementCommitment[]>

// Portfolio (SAP PPM/RPM)
listPortfolios?(ctx): Promise<SapPortfolio[]>
listPortfolioItems?(ctx, portfolioId): Promise<SapPortfolioItem[]>

// Master data (join spine; cached read-through only, see guardrails)
resolveMasterData?(ctx, refs: MasterDataRef[]): Promise<MasterDataRecord[]>
```

Every one returns **content-shaped read models** (typed, minimal, display-oriented) — not raw SAP
payloads. The mapping from SAP fields → our read models lives in the adapter, unit-tested against a
**demo SAP adapter** (a fixture backend, mirroring `broker/demo.ts`) so the pipeline is testable with
no SAP tenant.

### Screens are ARTIFACTS — pure JSON, never TypeScript

A "copy of a SAP screen" is an **artifact**: a JSON screen def rendered by the **generic engine**, with no
bespoke component. `screens/sap-project-cost.json` places a generic `table` panel bound (via `source.url`) to
a **rows read model** — `GET /projects/:id/wbs/cost-rows` returns `{ rows: [{ wbs, name, status, budget,
actual, committed, available }] }`, the WBS+financials join. The only supporting ENGINE code (reusable by any
artifact, not SAP-specific) is generic `{projectId}` source-URL templating (`lib/panel-source`), so a JSON
panel can bind a project-scoped endpoint. Rule of thumb: **new SAP capability = new JSON + (occasionally) a
generic engine primitive that serves everyone — never a per-artifact TypeScript renderer.**

## Allowed writes (narrow, API-permitted, never the ledger)

The broker's write seam already exists (`createProject`, `writeIssue`, task writes…). Against SAP we
permit **only** what SAP's own APIs allow as transactional work, capability-gated + audited:

- ✳ Create/update a **project task / WBS element** where the SAP API permits (planning, not posting).
- ✳ Submit a **timesheet entry** (CATS) via API — SAP validates + posts; we never post to the GL.
- ❄ Everything financial (cost, budget, recognition, settlement) stays read-only.

## Connectivity & auth

S/4HANA (Cloud and, via Cloud Connector, on-prem/private) exposes most of the above through **OData /
CDS APIs** (SAP API Business Hub / SAP Business Accelerator Hub). The adapter is an OData read client —
we **already ship an OData surface** (`lib/odata.ts`, `routes/odata.ts`), so this reuses that idiom.

- **Cloud (RISE / S/4HANA Cloud):** OAuth 2.0 (client credentials or SAML bearer assertion for
  principal propagation), tokens + endpoints held in the environment / vault — **not** in config.
- **Private / on-prem:** via **SAP BTP Destination service + Cloud Connector**, or a direct OData
  endpoint reachable through the broker's egress allow-list.
- **Principal propagation:** where the org needs SAP-side authorization to bite per user, propagate the
  user (SAML bearer) so SAP's own auth object checks apply; otherwise a technical read user, scoped
  minimally. The choice is a deployment setting, audited.
- Credentials ride the **vault** (like AI-provider keys), never the settings/config JSON — consistent
  with the backup posture (secrets travel only inside the sealed backup, never plaintext).

## Guardrails (so this stays "us")

1. **References, never copies.** Persist SAP ids/pointers; fetch on demand; render live. Reads honour
   the broker cache's adaptive TTL, but the SoR is always SAP.
2. **No write-back to the ledger.** Postings/recognition/settlement are read-only, full stop.
3. **Optional sidecar for genuine history/analytics** (trend lines, Monte Carlo inputs, snapshots for
   §4.3): opt-in, **retention-bounded** (reuse `historyRetention`), explicit — never the core, never
   silent. Same discipline as the audit evidence log.
4. **Join keys first.** Land the master-data resolution before the roll-ups that depend on it.
5. **Capability-gated + audited.** Every SAP read/write goes through the broker's capability governance
   and lands in the audit chain, like every other backend action.
6. **Data residency.** Reads cross a data-flow boundary; the residency policy (`lib/data-residency`)
   and egress allow-list apply — an SAP endpoint is an egress target, gated like a webhook/peer.

## Build slicing

- **Slice 1 — Project/WBS + core financials (the credibility slice).** OData read adapter for
  project→WBS structure + `getWbsFinancials` (actual / commitment / budget / WIP), surfaced on the
  existing budget/cost + project screens, with `resolveMasterData` for the join keys (cost object,
  company code, currency). Demo SAP fixture + conformance tests; no SAP tenant needed to test.
- **Slice 2 — Revenue recognition + margin** read models on the reports/portfolio surfaces.
- **Slice 3 — Timesheet actuals + procurement commitments** feeding resource + spend views.
- **Slice 4 — Portfolio (PPM/RPM)** hierarchy + financial plan as roll-ups with our what-if overlays.
- **Slice 5 — Narrow permitted writes** (project task / WBS planning edit, CATS timesheet entry),
  capability-gated + audited.

## Testing

- **Demo SAP adapter** (fixture) so every read model + mapping is unit-testable with no live tenant,
  mirroring `broker/demo.ts` + the broker conformance suite (`broker/conformance.ts`).
- **Contract conformance:** the SAP adapter passes the shared broker conformance tests for the core
  methods; the optional extensions have their own fixture-backed tests.
- **Zero-at-rest assertion:** a purity test that the SAP read models never land in the config snapshot
  or any sealed store (extends `config-purity.test`).

## Related

- `docs/BROKER.md`, `docs/INTEGRATION-PLANES.md` — the broker seam this rides on.
- `docs/DATA-RESIDENCY.md`, `docs/PRIVACY.md` — the egress + residency posture reads inherit.
- `docs/PPM-DEPTH.md` — where the project/finance read models surface in the product.
- `docs/FEATURE-ROADMAP.md` §4.6 (this connector), §4.1 (financial read models), §4.3 (portfolio
  analytics that consume these), §4.9 (config portability — the sibling wedge).
