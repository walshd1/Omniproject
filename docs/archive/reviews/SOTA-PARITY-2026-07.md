# State-of-the-art parity review — July 2026

A point-in-time gap analysis: what OmniProject would still need to reach parity with the
**absolute state of the art**, benchmarked against four different bars at once:

- **B1 — Modern work-management UX:** Linear, Monday.com, Asana, Notion (interaction quality,
  collaboration, automation-for-everyone).
- **B2 — Enterprise PPM/SPM depth:** Planview, Broadcom Clarity, Planisware, Sciforma, Jira Align
  (portfolio decisioning, resources, finance).
- **B3 — 2026 AI-native expectations:** agentic AI that plans/monitors/rebalances under governance,
  predictive analytics as the core PMO engine, AI reasoning logs (Wrike's governed agents,
  Monday's AI Project Manager).
- **B4 — Modern SaaS platform engineering:** multi-tenancy, extensibility/marketplace, durable
  jobs, indexed search, first-class APIs, mobile.

Grounding: this review is cross-checked against the codebase (SPA `artifacts/omniproject`,
gateway `artifacts/api-server`, contract `src/broker/{types,contract}.ts`) and the repo's own
candid registers ([ENTERPRISE-READINESS.md](../../ENTERPRISE-READINESS.md),
[TECH-DEBT-AND-ROADMAP.md](../../TECH-DEBT-AND-ROADMAP.md),
[FEATURE-MATURITY.md](../../FEATURE-MATURITY.md), [PPM-DEPTH.md](../../PPM-DEPTH.md),
[PARKED-DECISIONS.md](../../PARKED-DECISIONS.md)). Absences below were verified by grep, not
assumed.

---

## Verdict in one paragraph

OmniProject is **at or beyond parity on PPM analytics depth, governance, security posture and
integration architecture** — the six best-in-class depth modules (portfolio optimiser, OKR
cascade, skills capacity, timesheets, stage-gates, PI planning) are shipped
([PPM-DEPTH.md](../../PPM-DEPTH.md)), and the zero-at-rest overlay + broker seam + AI-governance
stack has no direct equivalent among the benchmarks. The distance to "absolute state of the art"
is concentrated in **five clusters**: (1) interactive collaboration UX, (2) agentic/predictive
AI, (3) in-product automation for end users, (4) platform plumbing (search index, job queue,
multi-tenancy, extensibility, mobile), and (5) **proof** — live-verified connectors,
attestations, and published scale results, which is what separates "feature-complete" from
"state of the art in production." Several gaps are in structural tension with the zero-at-rest
bet; each entry below names a state-respecting path where one exists.

---

## Where OmniProject already meets or beats the bar

Recorded so the gap list isn't read as "behind everywhere":

- **PPM depth (B2):** EVM/CPI/SPI, CapEx/OpEx + depreciation, Monte Carlo, CPM, portfolio
  optimiser (exact knapsack + efficient frontier), OKR cascade, benefits realisation, stage-gates,
  SAFe PI board, timesheets feeding EVM actuals — the B2 suites' headline modules, all stateless.
- **Governance & security:** org→programme→project feature governance, restrict-only business
  rulesets, maker-checker dual control, step-up re-auth, break-glass, tamper-evident audit chain
  with optional Ed25519 anchors, data-residency fail-closed control, provenance badging on every
  figure. None of the B1 tools and few B2 suites match this.
- **Identity:** OIDC+PKCE with per-user backend impersonation, SAML SP, SCIM 2.0 (deprovision
  enforced live mid-SSE), magic-link, read-only API tokens.
- **Integration architecture:** the published, generated, conformance-tested broker contract with
  41 catalogued backends, seven integration planes, self-service backend authoring — a genuinely
  different (and stronger) answer than the per-vendor connector lists at the benchmarks.
- **AI governance (the *control* half of B3):** capability gating, token budgets, model
  allowlists, kill-switch, containment levels, propose-only agentic writes, AI provenance lane,
  MCP server with double-gated writes. This is ahead of most of the market; it's the *capability*
  half that lags (below).
- **Accessibility:** WCAG 2.2 AA audit + axe regression gate + per-user a11y overlay (text scale,
  contrast, switch access, dictation) — beyond every benchmark.

---

## Gap catalogue

Status legend: **[missing]** not built · **[partial]** exists but below the bar ·
**[tension]** conflicts with the zero-at-rest core bet — a deliberate trade, listed with a
state-respecting path · **[proof]** built but unverified against the real world.

### 1. Collaboration & interactive UX (bar: B1 — Linear/Monday/Asana/Notion)

This is the widest visible gap. The SPA is deep on *reporting* and thin exactly where B1 tools
are richest: direct-manipulation, multiplayer work surfaces.

| Gap | Status | Detail & state-respecting path |
| --- | --- | --- |
| Rich-text everywhere | **[missing]** | Comments are a plain `<textarea>` (`components/issue-dialog/CommentsPanel.tsx`); no Tiptap/ProseMirror/Slate anywhere. SOTA is rich text with slash-commands, inline mentions, embeds. Editor state is client-side; no at-rest conflict. |
| Mention autocomplete | **[missing]** | `@mentions` are parsed server-side (`lib/comments.ts`); no client typeahead against project members. Pure UI work. |
| Real-time co-editing | **[missing]** | Presence is SSE avatars + advisory soft field-locks (`lib/presence.ts`); no CRDT/OT co-editing or live cursors. B1 tools are fully multiplayer. Ephemeral CRDT state (Yjs over the existing SSE/Redis bus, never persisted) would respect the posture. |
| Interactive Gantt dependencies | **[partial]** | `GanttChart.tsx` drags whole bars only — no dependency arrows, no link create/edit, no bar-resize handles, no critical-path overlay *on the timeline*. CPM and dependency links exist but only as separate reports. Blocked further by the contract gap in §6. |
| Kanban swimlanes & WIP limits | **[missing]** | `AgileBoard.tsx` is status-columns only; no swimlane grouping (assignee/epic/priority), no WIP-limit enforcement on the board (`wipLimit` absent) despite Kanban methodology packs declaring the concept. |
| Binary attachments | **[tension]** | Attachments are filename+URL references only (`useTaskAttachments`) — zero-at-rest by design. SOTA path without breaking the bet: **streaming pass-through upload to the backend's own storage** through the broker (gateway as courier, rung 3 of the [stateful-data ladder](../../PARKED-DECISIONS.md)), never buffered at rest. |
| Global undo | **[partial]** | Per-action toast undo (board move, grid) but no app-wide undo stack / `Cmd+Z` across recent mutations. |
| Per-user notification preferences | **[partial]** | One live-on/off toggle in localStorage; digests target roles/static recipient lists (`lib/digest-delivery.ts`). SOTA is per-event/per-channel subscription, quiet hours, digest opt-in — per-user prefs are small state (rung 2/3: `user-prefs` written back via broker or the shared-state seam). |
| Docs/wiki/whiteboard | **[missing]** | Only the lightweight `ContentPages` CMS. Deliberately out-of-thesis (would create a second place data lives) — if ever done, it must be a *window* onto Confluence/Notion/SharePoint via the broker, not a store. |
| Forms / request intake builder | **[missing]** | `DemandIntake` is a report, not a shareable intake form with field mapping into a backend write. A form definition is config (rung 1); submissions write through the broker. |
| Mobile apps | **[partial]** | Installable PWA with app-shell-only caching; no store-listed native app. Researched and parked (Capacitor + Fastlane, [PARKED-DECISIONS.md §A4](../../PARKED-DECISIONS.md)). |
| Offline / local-first | **[tension]** | No API/data caching offline (deliberate). A bounded, encrypted, session-scoped read cache on-device would be the maximum consistent with the posture; full local-first is off-thesis. |

### 2. AI — the capability half (bar: B3)

The governance rails are state-of-the-art; what runs *on* them lags the 2026 agentic bar.

| Gap | Status | Detail |
| --- | --- | --- |
| Supervised agentic execution | **[tension→partial]** | Everything is propose-only (`ai-autonomous` never executes; MCP writes human-confirmed). 2026 SOTA is agents that *execute multi-step plans under guardrails* with a reviewable reasoning log (Wrike's governed agents, Monday's AI PM). The rails already exist (autonomous principals in `lib/autonomous.ts`, capability grants, kill-switch, audit chain) — the missing piece is a bounded execution mode: pre-approved action classes, per-run budgets, step-by-step audit, instant revoke. This is a *policy* upgrade more than an architecture one. |
| Predictive analytics / forecasting | **[tension]** | Monte Carlo + linear trends exist, but no learned models: no risk scoring from history, no delivery-date prediction, no anomaly detection beyond rule-based HealthWatch. Root cause is structural — no history at rest to learn from. State-respecting path: train/evaluate over the **customer-owned** time-travel/logging store and snapshot exports (data stays theirs; models are derived artifacts). Until the time-travel plane is production-proven (§6) this stays blocked. |
| Retrieval quality (RAG) | **[missing]** | Copilot is snapshot-in-prompt (`routes/ai.ts`); no embeddings/vector index (grep: 0 hits). At portfolio scale, prompt-stuffing loses to indexed retrieval. An **ephemeral, per-session, in-memory** embedding index over the read model would respect zero-at-rest. |
| AI evaluation / benchmarks | **[proof]** | [FEATURE-MATURITY.md](../../FEATURE-MATURITY.md) is candid: NL→action planner and copilot accuracy are "unbenchmarked." SOTA products publish eval suites and regression-gate them in CI. Needs a golden-question corpus per surface (copilot Q&A, NL→action, estimation) with scored CI runs. |
| Auto-drafted narratives | **[partial]** | Exec digest + insights exist; SOTA adds AI-drafted status reports/highlight reports per project with one-click PMO review — a small extension over the existing insights + report surfaces. |

### 3. Automation for end users (bar: B1/B4)

| Gap | Status | Detail |
| --- | --- | --- |
| No-code trigger→action automations | **[missing]** | The governance ruleset is restrict-only (deny/warn — it cannot *do*). Real automation lives below the seam in n8n, which is invisible to a PM ("when an issue enters Blocked, post to the channel and assign the PMO reviewer" requires an n8n admin). SOTA (Monday/Asana/Jira) puts a recipe builder in-product. State-respecting design: automation *definitions* are config (rung 1); execution compiles to broker actions / generated n8n workflow fragments through the existing generator — the gateway still stores nothing and executes nothing durable. |
| Durable scheduling | **[partial]** | All schedulers are in-process `setInterval` (`lib/scheduled-job.ts`) — lost on restart, per-replica, no retry/backoff/dead-letter. Fine for digests; below the bar for anything a customer *relies* on. Path: external-cron-first (trigger endpoints already exist) plus an optional Redis-backed delayed-job mode on the existing shared-state seam. |
| Consumer-facing event stream | **[partial]** | Outbound HMAC webhooks cover `notification/audit/config.changed`; SOTA platforms expose a full domain-event firehose (issue.updated, project.created…) for subscribers. The broker seam sees every write — emitting a richer event vocabulary is incremental. |

### 4. Platform plumbing (bar: B4)

| Gap | Status | Detail |
| --- | --- | --- |
| Server-side search | **[tension]** | Global search is client-side, bounded 8-project fan-out (`lib/global-search.ts`; no gateway search route). No full-text index (no Elastic/Meili — deliberate: an index is a copy). Paths: push search down to backends that support it (JQL, OpenProject filters) via a broker `search` capability; or an ephemeral in-memory index per session. Cross-portfolio instant search at SOTA quality without *any* index is the hardest structural trade in the product. |
| Multi-tenancy | **[missing]** | Designed end-to-end (`docs/archive/design/MULTI-TENANCY-DESIGN.md`), not implemented; single-tenant today ([TECH-DEBT §4](../../TECH-DEBT-AND-ROADMAP.md)). Required for any pooled managed offering; also unlocks per-tenant rate plans/quotas (absent — limits are global/role-scoped only). |
| Third-party extensibility | **[partial]** | Backends/views/reports are addable *in-repo* (planes + catalogue), and custom backends can be authored at runtime — but there is no sandboxed third-party plugin runtime, no marketplace, no versioned extension API. SOTA (Atlassian Forge, Monday apps) treats the ecosystem as the moat. The seven-planes catalogue is the natural substrate; the missing layer is packaging/sandboxing/distribution. |
| GraphQL (or equivalent typed query API) | **[missing]** | REST + OpenAPI + OData only (grep: 0 GraphQL hits). Arguably optional given OData + generated clients; noted because every B1 benchmark ships one. |
| Managed/hosted offering | **[missing]** | Self-host only; Railway recipe is manual, "Deploy" button pending a maintainer run ([PARKED-DECISIONS §A2](../../PARKED-DECISIONS.md)). SOTA parity for adoption (especially charities/SMEs) needs at least one-click deploys, ideally a hosted tier (blocked on multi-tenancy). |
| i18n breadth | **[partial]** | 4 locales (en/fr/de/es), curated key coverage, framework ready; SOTA ships 15–30+ full locales ([PARKED-DECISIONS §C2](../../PARKED-DECISIONS.md)). |
| Fleet-consistent runtime state | **[partial]** | Session cap, settings store, audit-chain head, governance log are per-replica RAM unless Redis/file-backed ([TECH-DEBT §2](../../TECH-DEBT-AND-ROADMAP.md)); the governance log's 200-entry RAM ring is flagged as a compliance gap. |

### 5. Domain-model depth (bar: B1/B2)

The broker contract (`src/broker/types.ts`) is rich on financials/effort/risk/tasks, but four
concepts every B1/B2 benchmark treats as first-class are vocabulary strings here, not entities:

- **Sprints/iterations** — derived from labels/fields; no sprint entity (open/close/carry-over,
  sprint goals, real velocity history).
- **Epics / work-item hierarchy** — `parentTaskId` exists on GTD tasks, but issues have no
  epic→story→subtask hierarchy in the contract.
- **Explicit dependency graph** — `blocked/blockedReason` flags plus exploration-mode hash-links;
  no `dependsOn[]` edges readable/writable through the broker ([METHODOLOGIES.md](../../METHODOLOGIES.md)
  already names this as the CPM roadmap need). This single contract addition unlocks interactive
  Gantt links, network diagrams, true critical path on live data, and cascade-reschedule.
- **Milestones & baselines as entities** — `baseline()` read exists; milestones are date fields.
  B2 suites version baselines and report variance-to-baseline over time.

Also below the B2 bar: **worklog entries** (time tracking is aggregate `loggedHours` +
timesheets; no per-entry worklog model) and a **live FX feed** (the fallback table is
`provenance: "sample"`; [ENTERPRISE-READINESS §2.2](../../ENTERPRISE-READINESS.md) roadmap #1),
plus the **ERP actuals book-of-record adapter** (roadmap #10).

### 6. Proof — the gap between "built" and "state of the art in production"

The repo's most distinctive honest finding: much of the surface is **[proof]**-gapped rather than
feature-gapped. At the benchmarks, these are table stakes because they're *demonstrated*:

- **The n8n contract has never executed inside real n8n** — named in
  [TECH-DEBT §1](../../TECH-DEBT-AND-ROADMAP.md) as the single highest-value missing test.
- **0 of 41 catalogued backends verified against a live tenant** (SAP, Oracle, NetSuite, D365 all
  "catalogued, not live-verified"); SQL/Mongo sidecars untested against real DBs.
- **No independent attestation:** SOC 2 / ISO 27001 are control *mappings*, no pen-test summary,
  no signed images/registry publication (cosign parked), GitHub native secret-scanning off.
- **No published scale/load result** (harness exists; queue-mode n8n numbers are placeholders);
  sample k8s manifest still ships single-replica SQLite n8n; no tested multi-region DR runbook.
- **KMS/vault/OTLP adapters mock-verified only;** Authentik blueprint never applied live.
- **Time-travel & exploration** remain Experimental/Beta (unproven end-to-end; a known
  data-loss-risk bug in the replica workbench dirty-flag).

---

## Priority read (if closing the gap were sequenced)

1. **Proof sweep (§6)** — live n8n CI run, 2–3 verified flagship backends, pen test, published
   load result, signed images. Cheapest ratio of credibility-gained to code-written; everything
   else is discounted until this is done.
2. **Dependency graph + sprint/epic entities in the contract (§5)** — one contract change that
   unlocks the most-visible UX gaps (interactive Gantt, real CPM on live data, true velocity).
3. **Collaboration layer (§1)** — rich text + mention autocomplete + swimlanes/WIP + interactive
   Gantt; this is what evaluators coming from Linear/Monday notice in the first ten minutes.
4. **In-product automation recipes (§3)** — config-only definitions compiled through the existing
   workflow generator; closes the most-used B1 feature without breaking statelessness.
5. **Agentic execution mode + AI evals (§2)** — the governance rails are already ahead; add the
   bounded execution and the benchmark suite and the AI story leads the market instead of
   trailing it.
6. **Multi-tenancy → managed offering (§4)** — the largest lever for reach, already designed,
   gated on maintainer decisions.

---

*Point-in-time review (July 2026), measured against the tree at `main@7dc61a4`. Every item has
since been dispositioned in [FEATURE-ROADMAP.md](../../FEATURE-ROADMAP.md) (Phase 5 harvests
this review; Phase 4.12 and the ❄ markers record the won't-build calls) — and a parallel build
wave has already shipped several of the gaps named above (intake forms, automation recipes,
wiki with Yjs co-editing, whiteboards, guest portals, encrypted offline cache, Web Push, typed
dependencies + auto-scheduling, OKR goals, invoicing, a plugin marketplace), so read the
roadmap's per-item status, not this frozen text, for what is still open.*
