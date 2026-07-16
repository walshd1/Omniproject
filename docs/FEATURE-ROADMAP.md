# Feature Roadmap — competitive gap backlog

**Purpose.** This is the durable, version-controlled backlog of features that close the
gap between OmniProject and the leading project/portfolio tools (Jira/Jira Align, Asana,
Monday, Smartsheet, MS Project, Planview/Clarity, Wrike, ClickUp, Linear, Notion). It
exists so that *whenever there is engineering capacity*, the next item can be picked up
without re-doing the analysis. Work top-down: finish a phase before starting the next,
and tick items as they land.

> **How to use this doc.** Each item has a stable `id`, a one-line rationale, the
> competitors that have it, crisp acceptance criteria, and an "architecture leverage"
> note (what existing OmniProject machinery it reuses). When you complete an item, change
> its status to ✅ **Done** with the commit/PR reference, and move the next `Todo` to
> 🚧 **In progress**. Keep the phases ordered by leverage-per-cost.

## Where OmniProject already leads (context)

OmniProject is a **stateless governance + portfolio overlay** on top of systems of record
(41 connectors), not a Jira/Asana clone. It already meets or beats the field on:

- **PPM depth** — EVM, Monte-Carlo schedule risk, critical path, capacity levelling,
  scenario/what-if, benefits realisation, stage gates, multi-currency + rate cards
  (rivals Planview/Clarity).
- **Governance & security** — passkey-signed approval chains, responsibility acceptance,
  tamper-evident audit chains, SCIM/OIDC/SAML, data residency, SSRF/egress control,
  federation, BYOK/KMS, break-glass, DSAR (exceeds mainstream competitors).
- **AI governance** — kill switch, DLP redaction, per-role model allowlists, provenance.

The gaps are therefore concentrated in the **team-facing collaborative work-management
surface** and **agency/marketing** use cases — the half of the market that
Monday/Asana/ClickUp/Wrike own.

---

## Phase 1 — highest leverage, lowest cost (ride the existing architecture)

These three reuse the JSON-screen + panel registry + broker seam + workflow engine that
already exist, so they close the most competitive distance for the least build.

### 1.1 Intake / request forms  ✅ Done
- **Rationale.** End-user forms that capture a request → create work. The single clearest
  miss vs every competitor (a *DemandIntake report* is not a form).
- **Competitors.** Asana, Monday, Smartsheet, Wrike, Jira Service Management.
- **Acceptance.** (a) Admin/PMO can author a form (fields, types, required, target
  project) and store it in org config; (b) a `form` panel renders any form on a screen and
  validates client-side; (c) submit creates an issue through the broker with mapped fields
  + an intake marker (status/label), RBAC- and scope-guarded; (d) malformed defs/submits
  return typed 400s, never 500; (e) a routed **Intake** screen ships by default.
- **Architecture leverage.** New `form` panel kind; `forms` settings collection; a `form`
  methodology-composition kind; submission → `broker.writeIssue(create)` (same path as
  `POST /projects/:id/issues`).
- **Delivered.** Built exactly like screens/reports: shared **form template catalogue**
  (`@workspace/backend-catalogue` `FORMS`) → org-overridable `forms` config store →
  `form` composition kind (methodology-tagged) → generic `FormPanel` renderer → visual
  `FormsAdmin` builder (new / from-template / structured field + target editor) → routed
  `Intake` screen. Server: `lib/form-def.ts` (validation + submission→IssueWrite),
  `routes/forms.ts` (defs GET/PUT admin-PMO + scope-guarded `/forms/:id/submit`).
  Tests: shared catalogue (3), form-def (12), forms route (7), FormPanel (4), FormsAdmin (3).
- **Field primitives (have).** text, textarea, number, date, select, checkbox, email, url —
  all with server-side validation. **Backlog (add as needed):** multi-select, radio,
  currency/money, user/assignee picker, project/entity picker, section/heading (layout),
  hidden/prefilled (e.g. requestedBy = current user), datetime/time, rating/scale, and
  conditional (show-if) logic. See "Form primitive backlog" below.
- **Input sanitisation & validation (in place).** Global 256 kb body limit +
  proto-pollution key stripping on all JSON; def validation blocks dangerous keys, whitelists
  field types, requires select options, and only maps to an issue-field allow-list;
  submission validation is whitelist-by-def (unknown submitted keys dropped), enforces
  required, coerces number/checkbox, checks select membership + email/url format, and caps
  every text field (own `maxLength`, else a 2 000-char default, hard ceiling 10 000);
  submit is `contributor`+ and project-scope-guarded, authoring is admin/PMO; the created
  issue now runs the **same business ruleset** as the interactive grid (read-only /
  require-description / … → 422). All writes flow through the broker sanitizer + audit.
- **Capability gating (vendor-advertised fields only).** A form may only map onto issue
  fields the connected backend ADVERTISES as storable (`FieldSupport.store`) — the same
  capability plane that gates the interactive grid's editable fields. Enforced at BOTH ends:
  authoring (PUT /forms rejects a map to an unsupported field, naming it) and submit
  (defensively drops any field the backend no longer advertises, in case capabilities
  changed since authoring). Core fields (projectId/title) are always kept.
- **Mandatory field mapping (nothing is homeless).** Every form field MUST declare a
  `mapTo` — the backend field its value writes to — so a value always has a place to live;
  there is no "dump everything into the description" fallback. Validation (server + admin
  builder) requires: a `mapTo` on each field, that it is a *writable* issue field, exactly
  one field mapped to `title`, and unique scalar targets (`description`/`labels` may
  aggregate several fields; everything else is one-field-each). If the backend can't store
  a field, or the builder doesn't map it, the field can't be used. The admin builder's
  "maps to" picker only offers capability-writable targets.

### 1.2 User-facing automation recipes  ⬜ Todo
- **Rationale.** A friendly "when X, do Y" builder. The powerful JSON **workflow engine +
  broker templates** already exist but are admin/developer-facing — this is the missing
  on-ramp.
- **Competitors.** Monday, Asana, ClickUp, Wrike, Smartsheet.
- **Acceptance.** (a) A trigger→condition→action recipe UI; (b) recipes compile to the
  existing workflow-engine JSON and run through the existing runner (no new engine);
  (c) a recipe library stored in org config; (d) dry-run/preview before enable; (e) runs
  are audited and honour existing RBAC/approval gates.
- **HARD CONSTRAINT — RBAC-gated authoring + execution.** A user may only automate what
  they are themselves permitted to edit. This is non-negotiable and must hold at BOTH ends:
  - **Authoring:** the recipe builder only offers actions/collections the author currently
    has edit rights to. An action the author can't perform by hand (e.g. editing RACI when
    the RACI collection edit-policy requires PMO, or writing a project outside their scope)
    is not selectable, and a saved recipe that references one is rejected server-side.
  - **Execution:** the recipe runs with the AUTHOR's effective permissions, scoped by the
    same `requireCollectionEdit` / project-scope / ruleset checks the interactive edit
    path uses — **never widened**. A later drop in the author's permissions (offboarding,
    role change) disables or re-scopes the recipe; it must not become a privilege-retention
    backdoor. Autonomous execution binds to an explicit grant (the existing
    autonomous-guard model), and privileged effects still pass approval chains.
  This mirrors the workflow engine's existing invariant ("effects are injected, RBAC-scoped
  by the caller, never widened") — the recipe UI must not become a way around it.
- **Architecture leverage.** `workflow.ts` interpreter + `workflow-run.ts` effects (already
  RBAC-scoped by caller); `requireCollectionEdit` / `collection-edit-policy` for the
  per-collection gate; `autonomous-guard` + `autonomous-grant` for scheduled/agent runs;
  scheduled-job/recurrence for time triggers; settings collection for recipe defs.

### 1.3 Project & portfolio template gallery  ⬜ Todo
- **Rationale.** "Spin up a project/portfolio from a template." Everyone has it; OmniProject
  has methodology presets + screen-def bundles but no end-user template gallery.
- **Competitors.** All of them.
- **Acceptance.** (a) Capture a project's screen defs + config bundle + seed work items as a
  named template; (b) browse a gallery and instantiate; (c) templates are shareable org
  config and can ship as bundles (new-methodology delivery vehicle); (d) instantiation is
  audited.
- **Architecture leverage.** `config-bundle`/`config-snapshot` plumbing; `screenDefs`
  merge; methodology composition presets.

---

## Phase 2 — expected by specific segments

### 2.1 Collaborative docs / wiki / knowledge base  ⬜ Todo
- **Competitors.** Notion, ClickUp, Confluence, Wrike. **Gap.** "Content pages" is a CMS
  library, not real-time rich-text co-editing / linked wiki.
- **Acceptance.** Rich-text documents with links/embeds, per-space organisation, presence
  on a doc, comments/mentions, version history; readable/editable under existing RBAC.
- **Leverage.** Presence hub + comments + content-pages storage; reuse SSE for co-presence.

### 2.2 Guest / external collaboration & client portals  ⬜ Todo
- **Competitors.** Monday, Wrike, Smartsheet. **Gap.** Enterprise-IdP/SCIM only; no
  limited-seat guest access (blocks agencies/consultancies).
- **Acceptance.** Scoped guest principals (single project/board), magic-link or restricted
  IdP, read-or-comment tiers, no portfolio/admin surface, fully audited; a client-facing
  status portal view.
- **Leverage.** magic-link auth, RBAC ladder, scope guards, screen visibility gating.

### 2.3 Whiteboards / visual canvas  ⬜ Todo
- **Competitors.** Miro/Mural, ClickUp, Monday. **Gap.** No infinite canvas.
- **Acceptance.** Freeform canvas (sticky notes, shapes, connectors, freehand), multi-user
  live cursors, convert a sticky → work item; export.
- **Leverage.** Presence/live-events; new `canvas` panel kind; drill-to for item creation.

### 2.4 Proofing / deliverable review & annotation  ⬜ Todo
- **Competitors.** Adobe Workfront, Wrike, Smartsheet. **Gap.** No creative review markup.
- **Acceptance.** Attach a deliverable (image/PDF), pin annotations, threaded review,
  approve/reject decision bound to a version; ties into approval chains.
- **Leverage.** Approval-chain + passkey sign-off; comments; attachments as references.

### 2.5 Native mobile + offline  ⬜ Todo
- **Competitors.** All. **Gap.** PWA caches app-shell only; no offline data, no native apps.
- **Acceptance.** Offline-capable data cache for my-work/tasks with sync-on-reconnect;
  installable; push notifications; (stretch) native shells.
- **Leverage.** Existing PWA service worker; my-work/tasks read models; notifications SSE.

---

## Phase 3 — deepen what exists only partially

### 3.1 Full interactive scheduling engine  ⬜ Todo
- **Competitors.** MS Project, Smartsheet, Planview. **Have.** Gantt + CPM + baselines +
  Monte-Carlo. **Missing.** Auto-scheduling: working calendars, task constraints
  (SNET/FNLT), lead/lag, drag-a-bar-and-cascade-dependencies.
- **Leverage.** `critical-path.ts`, GanttChart, dependencies lib, baseline.

### 3.2 Goals / OKRs as a managed cadence  ⬜ Todo
- **Competitors.** Asana Goals, Viva Goals, ClickUp. **Have.** Strategy cascade + PI board
  as *reports*. **Missing.** First-class goal objects with check-ins, progress updates,
  goal↔work linking on a cadence.
- **Leverage.** strategy-cascade lib, reminder-sweep/recurrence for check-in cadence.

### 3.3 Live time tracking + invoicing  ⬜ Todo
- **Competitors.** Harvest/Toggl, Workfront. **Have.** Timesheets (submit/approve) +
  income/invoicing reports. **Missing.** Start/stop timers, invoice generation.
- **Leverage.** timesheet lib, income/invoicing reports, financials.

### 3.4 Third-party app / plugin marketplace  ⬜ Todo
- **Competitors.** Jira/Monday/Asana marketplaces. **Have.** 41 connectors + MCP + broker
  seam. **Missing.** UI-extension ecosystem (installable panels/screens/reports).
- **Leverage.** Panel registry, screen-def bundles, MCP, config-bundle delivery.

---

## Single shared primitive store

`artifacts/omniproject/src/lib/primitive-store.ts` is THE one catalogue over every renderable
building block, so screens, reports, dashboards, content pages and forms draw from one source
of truth rather than a registry each. Four families under one `Primitive` shape + one
`placeableIn` vocabulary:

- `panel` — screen building blocks (from the panel renderer registry)
- `viz` — data-visualisation primitives (from the chart primitive library; shared by chart
  panels *and* reports)
- `field` — form input controls (from the shared `FORM_FIELD_TYPES`)
- `component` — hosted reports + dashboard widgets (from the shared component library)

Each primitive carries a **`category` subfolder** (the palette groups as `family / category`) and
**`tags`** (orthogonal, cross-cutting labels for filtering — "timeseries", "editable", "financial",
…). Helpers: `primitiveTree(surface?)` (family → category subfolders → primitives, optionally scoped
to a placement surface), `categoriesFor(family)`, `allTags()`, `primitivesByTag(tag)`,
`primitivesFor(surface)`.

It doesn't rip out the family-specific renderer maps (a renderer is a React component and must
live in the app); it unifies their metadata and a **drift guard** (`primitive-store.test.ts`)
binds each family back to its registry, so the store can never silently diverge from what
actually renders. **Follow-up:** migrate the browsable palette + each authoring surface
(ScreenEditor, report/dashboard builders, FormsAdmin) to render from `primitiveTree(surface)` so
there is one folder/tag-organised palette everywhere too.

## Form primitive backlog

Ordered by value for a PPM/intake context. Each is a new `FormFieldType` in the shared
catalogue + a branch in `validateSubmission` (server) and `FormPanel`/`FormsAdmin` (client).

1. **user / assignee picker** → maps to `assignee`; pick a real member, not a free string.
2. **multi-select** → maps to `labels` (array); checkboxes or a multi-select control.
3. **radio** → single choice with visible options (select UX variant).
4. **currency / money** → maps to `budget` (+ currency); numeric with a currency code.
5. **project / entity picker** → choose the target/related project at submit time.
6. **section / heading** → layout-only, non-input; groups long forms.
7. **hidden / prefilled** → e.g. `requestedBy` = current user, `source` = "intake form"
   (server-stamped, never trusted from the client).
8. **datetime / time** → finer than `date` for scheduling intake.
9. **rating / scale** → 1–5 impact/severity capture.
10. **conditional (show-if)** → show a field only when another has a given value (logic, not
    just a primitive) — the largest lift; do last.

File attachments are intentionally **not** a primitive: the platform stores no files at rest,
so an attachment field would be a URL reference (`url` type) pointing at the system of record.

## Status legend

- ⬜ **Todo** — not started.
- 🚧 **In progress** — actively being built.
- ✅ **Done** — shipped; record the commit/PR.

## Changelog

- _2026-07-16_ — Roadmap created from competitive gap analysis. Phase 1.1 (Intake forms)
  started.
- _2026-07-16_ — Phase 1.1 (Intake forms) shipped, built on the screen/report pipeline
  (shared template catalogue → org-override store → composition kind → generic panel →
  visual admin builder → routed screen).
- _2026-07-16_ — Forms hardening: added email/url primitives + per-field length caps
  (default 2 000, ceiling 10 000), and routed form-created issues through the same business
  ruleset as the grid. Documented the form primitive backlog and, for 1.2, the hard
  RBAC-gating constraint (automate only what you may edit).
- _2026-07-16_ — Forms capability gating: a form can only map onto issue fields the
  connected backend advertises as storable, enforced at authoring and submit. **Next up:
  Phase 1.2 (automation recipes).**
