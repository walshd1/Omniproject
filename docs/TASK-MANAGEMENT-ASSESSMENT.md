# Task management — best-in-class assessment

> Companion to `docs/FEATURE-ROADMAP.md` and `docs/IAM-SECURITY-ASSESSMENT.md`, applying the same
> competitive-gap lens to the **GTD task / next-action capability** — measured against Todoist, Things,
> Asana, ClickUp and Linear. Like the IAM assessment, this is a *confirm-the-moat, then a focused gap
> wave* pass, not a rebuild. Sourced from a read of the live tree; file references are indicative anchors,
> not a contract.
>
> **Scope — the GTD `Task` entity, not the issue/work-item.** The repo carries a historical naming
> collision: some SPA surfaces call a project *work-item / issue* a "Task" (`TaskBoard`, `TaskItemsPanel`,
> `createTaskItem` all operate on **issues**). This assessment is about the distinct GTD **next-action**
> entity — the `/api/tasks` resource backed by `Task` in `broker/types.ts`, surfaced as "Next actions"
> (`artifacts/omniproject/src/lib/tasks.ts:4-9`, `broker/types.ts:105-109`). Issue scheduling / typed
> dependencies / epics are a separate plane tracked in `docs/FEATURE-ROADMAP.md` and are out of scope here.

## Where OmniProject already leads (context — NOT gaps)

**A rich, GTD-native task model.** `Task` (`broker/types.ts:110-155`) carries `status`, `priority`,
`context`, `energy` (GTD "in the tank" tank level), `startDate`/`dueDate`, `recurrence`, `reminderAt`,
`estimateHours`, `assignee` + `collaborators[]`, `tags[]`, `waitingOn`, `parentTaskId`, `section` and manual
`sortOrder` — standalone (project-less) personal tasks included. Create/update run through the governed
`mountEntity` pipeline (manager+); comments + capability-gated attachments alongside.

**Scope-configurable workflow + energy vocabularies.** Task statuses derive from the GTD methodology asset
(`assets/methodologies/gtd.json` → six canonical ids `next/waiting/scheduled/someday/done/dropped` over five
fixed workflow *classes*) and are relayerable org→programme→project→user with a tombstone-on-remove and a
one invariant: every status declares a class (`task-vocabulary-config.ts`). Energy is the same pattern
(`low/medium/high` ordinal, scope-configurable). Native-synonym folding (todo→next, blocked→waiting) keeps
imported data canonical (`broker/vocabulary.ts:163-198`).

**Recurrence + exactly-once reminders.** A pure `nextOccurrence(rule, after)` (`lib/recurrence.ts`) handles
RRULE-lite (`FREQ=…;INTERVAL=…`) plus natural phrases ("every weekday", "every 2 weeks", "monday"), overflow-
hardened and day-of-month-clamped. On **completion** a recurring task idempotently spawns its next occurrence
via a CAS claim (`tasks.ts:35-63`), shifting the reminder by the due delta. Reminders fire in-app through an
exactly-once sweep with a 30-day dedupe window (`lib/reminder-sweep.ts`, `POST /api/tasks/reminders/sweep`).

**Pure analytics + a real query surface.** `summariseTasks` (`lib/task-summary.ts`) computes open/actionable/
overdue/dueSoon/unassigned + by-class/assignee/tag/context; `lib/task-urgency.ts` adds urgency bands +
staleness. Filtering/sorting run on the shared `sort-filter.ts` engine (ordinal-aware, nestable AND/OR/NOT).
Tasks render through the view engine as a **GTD board**, a **Flow board** and a subtask-tree list
(`view-engine/task-descriptor.ts`, `lib/task-tree.ts` with cycle-breaking). There is a real **search syntax**
(`#tag @context is:overdue|today|soon|untouched status:x priority>=high`, `-`negation — `lib/task-search.ts`),
**task-aware saved views / smart lists** (`saved-views.ts` `entity:"task"`), and a **deterministic inline
quick-add** (`#tag @context !p1 ^tomorrow` — `lib/quick-add.ts`).

## Deliberate architectural stances (state so nobody "fixes" them)

- **Tasks (GTD next-actions) are deliberately distinct from issues/work-items** — different lifecycle (5
  GTD classes vs the 4-class issue lifecycle), different surface. Not a bug to "unify".
- **Stateless / no-DB, tools-as-source-of-truth** — tasks live in the brokered system of record; the overlay
  computes over them with pure functional-core catalogue modules. Any new engine belongs below the seam,
  deterministic, no persistence.
- **Hand-rolled recurrence, not the `rrule` library** — a conscious dependency decision
  (`docs/FEATURE-ROADMAP.md:1532`, `2162`); full RRULE (BYDAY lists / COUNT / UNTIL) is intentionally absent.
- **Saved views are customer-level / shared** by design (`saved-views.ts:4-8`), not per-user private filters.

## Gap analysis — ranked, classified by lane

**In-lane** = pure functional-core engine / scope-configurable vocabulary / governed route (the catalogue
pattern; high fit). **Out-of-lane** = SPA surface, contract-gen, or a cross-cutting change to another plane.

| # | Gap | Impact | Lane |
|---|-----|--------|------|
| **T1** | **No task→task blocking dependencies.** `waitingOn` is a free-text note; there is no `blockedBy`/`dependsOn` on `Task` and no ready/blocked computation. (Typed dependencies exist only for **issues**, `types.ts:815-818`.) Every peer tool has task dependencies. `critical-path.ts` / `cross-team-critical-path.ts` already do dependency graphs to reuse. | High | **In-lane (pure + thin field/route)** |
| **T2** | **No task workload / WIP / aging analytics.** `byAssignee` is a raw count; no per-assignee load, no WIP-limit signal (GTD asset sets `wipLimits:false`), no aging/cycle-time distribution (staleness is a boolean). `capacity.ts` + the `task-summary` shape are the reuse substrate. | Medium-High | **In-lane (pure)** |
| **T3** | **GTD @contexts are free text, not a vocabulary.** `context` is an unbounded string (`types.ts:117`); statuses + energy are first-class scope-configurable vocabularies but contexts are not — so `@calls/@errands/@computer` can't be curated, coloured, or reported on consistently. Mirrors `energy-vocabulary` exactly. | Medium-High | **In-lane (pure + config route)** |
| **T4** | **Task priority is a frozen enum, not scope-configurable.** `v.enum(CANONICAL_PRIORITY)` at the write boundary (`tasks.ts:155`), unlike status/energy which were relaxed to membership checks — an org can rename statuses but not add a task priority band. | Medium | **In-lane (pure + config route)** |
| **T5** | **No server-side bulk for tasks.** `bulk.ts` covers projects only (`update_project`/`create_project`); task bulk is best-effort **client fan-out** of N single creates (`lib/tasks.ts:81`), with no dry-run/confirm/transactional semantics. No bulk complete/reassign/reschedule/retag/move. | Medium-High | **In-lane (pure planner + route)** |
| **T6** | **No "My Day" / today-planning surface.** No daily commitment list; only urgency bands + an offline read-model cache. A pure "plan my day" selector (overdue + due-today + flagged, energy-fit, WIP-capped) is the engine; the surface is SPA. | Medium | **In-lane (pure) + Out-of-lane (SPA)** |
| **T7** | **No upcoming-occurrence projection.** Recurrence yields the next instance only **on completion**; there is no bounded "next N occurrences" series for planning/calendar preview. `recurrence.nextOccurrence` iterated N times, bounded, is the whole engine. | Medium | **In-lane (pure)** |
| **T8** | **AI / NL cannot create tasks.** The NL planner (`nl-action.ts`) has **no task MCP tools** (grep of `mcp.ts`/`tools.ts` for task → none); deterministic quick-add parses `#tag @context !p ^date` but no time-of-day ("3pm") into `reminderAt`. | Medium | **In-lane (route + pure parse) ** |
| **T9** | **No checklists as a first-class concept** — only the doc-comment guidance to model them as subtasks (`types.ts:138`). A lightweight ordered checklist on a task (distinct from full subtasks) is a common buyer expectation. | Low-Medium | **In-lane (field/route)** |
| **T10** | **Time tracking is not linked to tasks.** `timer.ts` / `timesheets.ts` key on `projectId`/`issueId` only — no `taskId`; `estimateHours` has no actuals linkage, so estimate-vs-actual on a next-action is impossible. | Medium | Out-of-lane (timer/timesheet + SPA) |
| **T11** | **Tasks are absent from the OpenAPI/Zod contract** — the SPA task hooks are hand-written, not generated (`lib/tasks.ts:7-9`), so tasks miss the contract-drift guard the rest of the API enjoys. | Low-Medium | Out-of-lane (contract-gen) |

## Proposed programme — "Task Management" wave

Same discipline as the P3M and Security & IAM catalogue lanes: **one PR per slice**, pure functional-core
below the broker seam, deterministic tests (no `Math.random`/`Date`), guarded divides / fail-closed, reuse-
over-duplicate, auto-merge per slice. Sequenced by leverage and pure-first:

- **Slice 1 — Task dependency graph engine (T1).** A pure module: task set + `blockedBy` edges →
  `{ ready | blocked }` classification, **cycle detection**, topological "ready-now" ordering, and the
  longest blocking chain among tasks — **reusing `critical-path.ts` / `cross-team-critical-path.ts`**
  graph logic and the `task-summary` result shape. Deterministic, empty ⇒ empty. The `blockedBy` field +
  its PATCH wiring (guarded by a cycle-reject) is a thin follow-on on top of the pure engine.
- **Slice 2 — GTD context vocabulary (T3).** Promote `@context` to a scope-configurable vocabulary
  **mirroring `energy-vocabulary` / `task-vocabulary` exactly** (canonical seed asset + resolver + sanitizer
  + `GET/PUT /api/task-context-vocabulary`), so contexts curate/colour/report like statuses. High fit, small.
- **Slice 3 — Task workload / WIP / aging engine (T2).** Pure: tasks + `now` + per-assignee WIP limits →
  per-assignee load, over-WIP flags, and aging buckets (cycle-time distribution), **reusing `capacity.ts`**
  patterns and `task-summary`. Guarded divides, empty ⇒ empty.
- **Slice 4 — Task bulk-operation planner + route (T5).** A pure plan/validate core (selection + patch →
  a validated per-task plan with a dry-run diff), then `POST /admin/tasks/bulk` **mirroring `bulk.ts`**
  (feature-gated, manager+, dry-run + confirm-token) — replacing the client fan-out with transactional-ish,
  audited semantics.
- **Slice 5 — "Plan my day" selector (T6, pure half).** Pure: tasks + `now` (+ optional energy/WIP budget)
  → a ranked today-commitment list (overdue + due-today + flagged, energy-fit, capped), reusing
  `task-urgency` + Slice 3's load signal. The SPA "My Day" surface is the out-of-lane follow-on.
- **Slice 6 (smaller, optional) — scope-configurable task priority (T4) + upcoming-occurrence projection
  (T7).** Relax the frozen priority enum to a membership-checked, scope-configurable vocabulary (mirror
  energy); add a bounded pure `upcomingOccurrences(rule, from, n)` iterating `recurrence.nextOccurrence`.

**Deferred / out-of-lane (tracked, not in this wave):** T9 checklists-as-first-class (modeled as subtasks
today — revisit only on a concrete buyer ask), T8 AI/NL task creation (needs a task MCP-tool surface + time-
of-day parsing — a broader cross-cut), T10 time-tracking↔task linkage (touches timer/timesheet routes + SPA),
T11 tasks-in-contract (contract-gen work). Full RRULE remains a **deliberate non-goal** per the roadmap.

## Status

**Wave complete.** Assessment authored (#918), greenlit, and all five build slices delivered on `next`:

- ✅ **Slice 1 — Task dependency graph engine (T1)** — #919 (`task-dependencies.ts`: blockedBy edges → cycle/ready-now/critical-order).
- ✅ **Slice 2 — GTD context vocabulary (T3)** — #920 (`task-context-vocabulary` + `GET/PUT /api/task-context-vocabulary`, mirroring energy/status).
- ✅ **Slice 3 — Task workload / WIP / aging engine (T2)** — #921 (`task-workload.ts`: per-assignee WIP load + age buckets).
- ✅ **Slice 4 — Task bulk-operation planner + route (T5)** — #922 (`task-bulk.ts` + `POST /api/tasks/bulk`: dry-run preview + confirm token, manager+ step-up, partial success).
- ✅ **Slice 5 — "Plan my day" selector (T6, pure half)** — #923 (`plan-my-day.ts`: overdue + due-today + flagged/high-priority, worst-first ranking, item/hours/energy budget caps). The SPA "My Day" surface remains the out-of-lane follow-on.

**Deferred (optional, not built):** Slice 6 — scope-configurable task priority (**T4**) + upcoming-occurrence projection (**T7**). Judged lower-leverage than the five delivered slices and not clearly worth its own PR right now: T4 is a small membership-relaxation that can ride a future task-config change, and T7's bounded `upcomingOccurrences` has no consuming surface yet. Tracked here; revisit on a concrete ask.

**Out-of-lane / deferred (unchanged):** **T8** AI/NL task creation (needs a task MCP-tool surface + time-of-day parsing), **T9** checklists-as-first-class (modeled as subtasks today), **T10** time-tracking↔task linkage (timer/timesheet routes + SPA), **T11** tasks-in-contract (contract-gen work). Full RRULE remains a **deliberate non-goal** per the roadmap.
