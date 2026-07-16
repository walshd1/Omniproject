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
  Tests: shared catalogue (3), form-def (8), forms route (6), FormPanel (4), FormsAdmin (3).

### 1.2 User-facing automation recipes  ⬜ Todo
- **Rationale.** A friendly "when X, do Y" builder. The powerful JSON **workflow engine +
  broker templates** already exist but are admin/developer-facing — this is the missing
  on-ramp.
- **Competitors.** Monday, Asana, ClickUp, Wrike, Smartsheet.
- **Acceptance.** (a) A trigger→condition→action recipe UI; (b) recipes compile to the
  existing workflow-engine JSON and run through the existing runner (no new engine);
  (c) a recipe library stored in org config; (d) dry-run/preview before enable; (e) runs
  are audited and honour existing RBAC/approval gates.
- **Architecture leverage.** `workflow.ts` interpreter + `workflow-run.ts` effects;
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

## Status legend

- ⬜ **Todo** — not started.
- 🚧 **In progress** — actively being built.
- ✅ **Done** — shipped; record the commit/PR.

## Changelog

- _2026-07-16_ — Roadmap created from competitive gap analysis. Phase 1.1 (Intake forms)
  started.
- _2026-07-16_ — Phase 1.1 (Intake forms) shipped, built on the screen/report pipeline
  (shared template catalogue → org-override store → composition kind → generic panel →
  visual admin builder → routed screen). **Next up: Phase 1.2 (Automation recipes).**
