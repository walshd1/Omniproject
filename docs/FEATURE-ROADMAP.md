# Feature roadmap

The consolidated **feature-level** roadmap, derived from the July 2026 state-of-the-art parity
review ([archive/reviews/SOTA-PARITY-2026-07.md](archive/reviews/SOTA-PARITY-2026-07.md)) and
disposed item-by-item. Everything from that review appears here **once, with a decision attached
— including the things we are deliberately not going to build**, recorded so they aren't
re-litigated (same pattern as [PARKED-DECISIONS.md §D](PARKED-DECISIONS.md)).

Division of labour with the other registers (this doc does not duplicate their contents):

- **[TECH-DEBT-AND-ROADMAP.md](TECH-DEBT-AND-ROADMAP.md)** — engineering debt, verification
  gaps, and fleet-correctness caveats.
- **[ENTERPRISE-READINESS.md](ENTERPRISE-READINESS.md)** — the buyer-panel gap analysis and its
  numbered roadmap (#1–#14).
- **[PARKED-DECISIONS.md](PARKED-DECISIONS.md)** — items blocked on a maintainer decision.

Status legend: **[candidate]** worth building, unscoped, not yet committed ·
**[tracked → …]** already owned by another register (pointer only) ·
**[decided-against]** recorded as not-to-build, with the revisit condition ·
**[tension]** annotation: touches the zero-at-rest bet — the entry names the state-respecting
design, which is the *only* form in which it may be built.

---

## 1. Collaboration & interactive UX

*Benchmark: Linear / Monday / Asana / Notion. The widest visible gap for evaluators.*

| Item | Status | Disposition |
| --- | --- | --- |
| Rich-text editing (comments, descriptions) | **[candidate]** | Replace the plain `<textarea>` surfaces with a rich-text editor (Tiptap-class), slash-commands, inline mentions. Client-side state only — no at-rest conflict. |
| Mention autocomplete | **[candidate]** | Client typeahead over project members feeding the existing server-side `mentions[]` parse (`lib/comments.ts`). Small, pairs with the rich-text item. |
| Interactive Gantt dependencies | **[candidate]** | Dependency arrows, link create/edit, bar-resize handles, critical-path overlay on the timeline. **Gated on the `dependsOn[]` contract entity (§5)** — build the contract first, then this UI. |
| Kanban swimlanes + WIP-limit enforcement | **[candidate]** | Swimlane grouping (assignee/epic/priority) and on-board WIP limits; the Kanban methodology pack already declares the WIP concept — the board should honour it. |
| Per-user notification preferences | **[candidate]** | Per-event/per-channel subscription, digest opt-in, quiet hours. Small per-user state: rung 2/3 of the [stateful-data ladder](PARKED-DECISIONS.md) — write back via broker or the shared-state seam, never a gateway store. |
| Forms / request-intake builder | **[candidate]** | Shareable intake forms mapped to backend writes. Form *definitions* are config (rung 1); submissions write through the broker. Complements the existing `DemandIntake` report. |
| Global undo stack | **[candidate]** | App-wide `Cmd+Z` over recent inverse-able mutations, generalising the existing per-action toast undo. |
| Binary attachment pass-through | **[candidate]** **[tension]** | Today: reference-URLs only. Only permissible form: **streaming courier** to the backend's own storage through the broker — never buffered at rest in the gateway. Anything else is decided-against. |
| AI-drafted status narratives | **[candidate]** | One-click AI-drafted highlight/status report per project with PMO review, extending the existing insights + exec-digest surfaces. (Listed here because it's a UX deliverable; AI plumbing in §2.) |
| Native mobile app | **[tracked → PARKED-DECISIONS §A4]** | Capacitor + Fastlane path researched; awaiting maintainer commitment to store ops. |
| Real-time CRDT co-editing / live cursors | **[decided-against]** | The backend owns the data; writes are field-level with optimistic concurrency (409) plus advisory presence locks — for an overlay this is the *correct* concurrency model, not a deficiency. CRDT merge of a document we don't own would fabricate states the backend never had. **Revisit only if** a first-party long-form editing surface (see docs/wiki below) is ever adopted. |
| Docs / wiki / whiteboard store | **[decided-against]** | A first-party store is a fourth place data lives — directly against the core bet. **Only permissible form:** a read/write *window* onto Confluence/Notion/SharePoint via the broker, treated as one more backend. Revisit only as that window, never as a store. |
| Full offline / local-first | **[decided-against]** | Violates zero-at-rest; the app-shell-only service worker is the designed behaviour. **Revisit condition:** a bounded, encrypted, session-scoped read cache on-device *may* be considered if field demand materialises; full local-first (queued offline writes, synced copies) stays off the table. |

## 2. AI — capability half

*Benchmark: 2026 agentic SOTA (governed agents with reasoning logs, predictive analytics as the
PMO engine). The governance rails are already ahead of market; these close the capability side.*

| Item | Status | Disposition |
| --- | --- | --- |
| AI evaluation suite | **[candidate]** — do first | Golden-question corpora + scored CI runs for copilot Q&A, NL→action, estimation. [FEATURE-MATURITY.md](FEATURE-MATURITY.md) is candid that accuracy is unbenchmarked; every other AI item below is discounted until this exists. |
| Supervised agentic execution mode | **[candidate]** | Upgrade propose-only to bounded execution: pre-approved action classes, per-run budgets, step-by-step audit-chain entries, instant kill-switch revoke. The rails (autonomous principals, capability grants, containment) already exist — this is a policy tier, not new architecture. Default **off**; propose-only remains the default posture. |
| Ephemeral RAG retrieval | **[candidate]** **[tension]** | Per-session, in-memory embedding index over the read model to replace snapshot-in-prompt at portfolio scale. Only permissible form: ephemeral (rung 2) — a persisted vector index is a copy and is decided-against (§4 search). |
| Predictive / learned forecasting | **[candidate]** **[tension]** | Risk scoring, delivery-date prediction, anomaly detection learned from history. Only permissible substrate: the **customer-owned** retention/time-travel store ([RETENTION.md](RETENTION.md), [TIME-TRAVEL.md](TIME-TRAVEL.md)) and snapshot exports. **Gated on** the time-travel plane being production-proven (see proof sweep, §6). |

## 3. Automation for end users

| Item | Status | Disposition |
| --- | --- | --- |
| No-code trigger→action recipes | **[candidate]** | In-product recipe builder ("when issue enters Blocked → notify channel, assign PMO reviewer"). Definitions are config (rung 1); execution compiles to broker actions / generated n8n workflow fragments via the existing generator — the gateway stores nothing and runs nothing durable. This is the single most-used B1 feature we lack. |
| Durable scheduling | **[candidate]** | Today: in-process `setInterval`, per-replica, no retry. Path: external-cron-first (trigger endpoints already exist) + an optional Redis-backed delayed-job mode on the shared-state seam. A full queue framework (BullMQ-class) is **not** the plan — it drags in durable state the overlay doesn't want. |
| Domain-event firehose | **[candidate]** | Widen the outbound webhook vocabulary from 3 event types to the domain set (`issue.updated`, `project.created`, …) the broker seam already witnesses. Incremental; unlocks subscriber ecosystems. |

## 4. Platform plumbing

| Item | Status | Disposition |
| --- | --- | --- |
| Server-side search (pushdown) | **[candidate]** **[tension]** | A broker `search` capability that pushes queries down to backends that can answer them (JQL, OpenProject filters), plus optionally an ephemeral per-session index. **A persistent full-text or vector index is decided-against** — an index is a copy. |
| Third-party plugin packaging | **[candidate]** | The seven-planes catalogue is the substrate; missing layer is packaging, sandboxing, versioned extension API, and distribution. Sequence *after* there's a community to serve — marketplace-before-users is backwards. |
| Multi-tenancy | **[tracked → TECH-DEBT-AND-ROADMAP §4]** | Designed (`archive/design/MULTI-TENANCY-DESIGN.md`); five open decisions before Phase 1. Prerequisite for hosted tier and per-tenant rate plans. |
| Per-tenant rate plans / quotas | **[candidate]** | Blocked on multi-tenancy; until then role-scoped global limits stand. |
| Managed / hosted offering, one-click deploy | **[tracked → PARKED-DECISIONS §A2]** | Railway recipe written; "Deploy" button needs a maintainer template run; hosted tier blocked on multi-tenancy. |
| i18n locale breadth | **[tracked → PARKED-DECISIONS §C2]** | Framework ready; needs the language shortlist + human-quality translations. |
| Fleet-consistent runtime state | **[tracked → TECH-DEBT-AND-ROADMAP §2]** | Shared-state seam adoption (session cap, settings, audit-chain head, governance log). |
| GraphQL API | **[decided-against]** | OData + OpenAPI + generated typed clients already serve the query/BI need; adding a second query surface is building ahead of demonstrated demand. **Revisit only if** a concrete integrator names a requirement OData cannot meet. |

## 5. Domain-model depth (broker contract)

*One contract change here unlocks half of §1. Sequence these before the dependent UI.*

| Item | Status | Disposition |
| --- | --- | --- |
| Explicit dependency graph (`dependsOn[]`) | **[candidate]** — highest leverage | First-class dependency edges readable/writable through the broker ([METHODOLOGIES.md](METHODOLOGIES.md) already names the need for CPM). Unlocks interactive Gantt links, network diagrams, live critical path, cascade-reschedule. |
| Sprint/iteration entity | **[candidate]** | Open/close/carry-over, sprint goals, real velocity history — today derived from labels/fields only. |
| Epic / work-item hierarchy | **[candidate]** | Epic→story→subtask on issues (GTD tasks already have `parentTaskId`; issues don't). |
| Baselines as versioned entities | **[candidate]** | Versioned baselines + variance-to-baseline over time; today a single `baseline()` read. |
| Per-entry worklogs | **[candidate]** | Worklog entries under the timesheet model; today aggregate `loggedHours` only. |
| Live/audited FX source | **[tracked → ENTERPRISE-READINESS roadmap #1]** | Fallback table is `provenance: "sample"`. |
| ERP actuals book-of-record adapter | **[tracked → ENTERPRISE-READINESS roadmap #10]** | |

## 6. Proof — verification, attestation, scale

All owned elsewhere; listed as one block because it is **priority #1** and everything above is
discounted until it lands:

- Live n8n contract execution in CI — **[tracked → TECH-DEBT-AND-ROADMAP §1]** (named there as
  the single highest-value missing test).
- Live-tenant verification of flagship backends; SQL/Mongo sidecars against real DBs —
  **[tracked → PARKED-DECISIONS §E4/§F1, FEATURE-MATURITY.md]**.
- KMS/vault, OTLP, Authentik live smoke tests — **[tracked → TECH-DEBT-AND-ROADMAP §1]**.
- SOC 2 / ISO attestation, pen test, signed images/SLSA, secret-scanning setting —
  **[tracked → ENTERPRISE-READINESS #5/#6, PARKED-DECISIONS §B]**.
- Published scale/load result; broker HA in the sample manifest; tested multi-region DR —
  **[tracked → ENTERPRISE-READINESS #3/#11]**.
- Exploration/time-travel out of Beta/Experimental (incl. the replica-workbench dirty-flag
  data-loss bug) — **[tracked → TECH-DEBT-AND-ROADMAP §5, EXPLORATION.md, TIME-TRAVEL.md]**.

## Previously closed (do not reopen)

Restated from their home registers so this doc is complete on its own:

- **Same-kind multi-broker read fan-out** — closed with rationale in
  [PARKED-DECISIONS.md §D](PARKED-DECISIONS.md) (it's the broker layer's job below the seam).
- **Runtime no-code view designer** — deliberate non-goal
  ([METHODOLOGIES.md](METHODOLOGIES.md)); views are open code, not a black box.

---

## Sequencing

1. **Proof sweep (§6)** — cheapest credibility per line of code; de-risks everything shipped.
2. **AI eval suite (§2)** — cheap, unblocks trusting every other AI item.
3. **Contract entities (§5):** `dependsOn[]` first, then sprints/epics.
4. **Collaboration layer (§1):** rich text + mentions + swimlanes/WIP + interactive Gantt (now
   unblocked by §5).
5. **Automation recipes + durable scheduling + event firehose (§3).**
6. **Agentic execution mode (§2)** on the existing rails.
7. **Multi-tenancy → rate plans → managed offering (§4)** — the reach lever, maintainer-gated.

---

*Keep this current the same way as TECH-DEBT-AND-ROADMAP.md: when an item ships, delete it (or
move its pointer); when a decided-against item's revisit condition is met, reopen it explicitly
here rather than around this register.*
