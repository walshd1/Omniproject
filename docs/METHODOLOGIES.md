# Methodology Views

OmniProject presents the same project work through interchangeable **methodology
views**. The data model is deliberately **methodology-neutral** (status,
priority, labels, dates, assignee); each view *derives* its concepts (sprints,
story points, stages, WIP, RAG) from that data, so you can look at one project as
Kanban, Scrum, PRINCE2, or a Gantt without re-keying anything.

Switch views from the **dashboard header** (the view switcher), or via **`Cmd+K`
→ Views**. The choice persists per browser.

## Built-in views

| View | Methodology | Shows | Driven by |
| ---- | ----------- | ----- | --------- |
| **Kanban Board** | Kanban / Lean | Status columns, drag-to-move, WIP limits | `status` |
| **Scrum Sprint** | Scrum | Active sprint board, product backlog, burndown, velocity | sprint membership + story points |
| **Gantt Timeline** | Waterfall / Critical Path | Time-phased bars, today marker, overdue | `startDate` / `dueDate` |
| **PRINCE2 Stages** | PRINCE2 | Management stages, product status, highlight report (RAG, exceptions, tolerances) | management stage + completion |
| **List / Table** | neutral | Sortable table of all work items | all fields |

## How concepts are derived

Everything works out-of-the-box with sample data, and gets richer when your n8n
workflow populates the optional labels below.

| Concept | Explicit (preferred) | Fallback |
| ------- | -------------------- | -------- |
| **Story points** | label `sp:5` / `points:5` | weighted by priority (urgent 8 … none 1) |
| **Sprint membership** | label `sprint:<name>` / `iteration:<name>` | committed work = `todo` / `in_progress` / `in_review` |
| **PRINCE2 stage** | label `stage:<name>` | status → `Initiation` (backlog/todo), `Delivery` (in_progress/in_review), `Closure` (done/cancelled) |
| **WIP limits** | — | `in_progress: 4`, `in_review: 3` (see `lib/methodology.ts`) |
| **RAG** | — | derived from completion % and overdue count |

> To make sprints/stages authoritative, have your n8n workflow attach the
> corresponding labels when normalizing issues from the backend (Jira sprints,
> Azure DevOps iterations, OpenProject phases, etc.).

> **Some views/reports need data a basic tracker may not have** (resource
> capacity, costs, baselines). See **[DATA-REQUIREMENTS.md](DATA-REQUIREMENTS.md)**
> for the field-by-field source mapping and what each view does when a domain is
> missing — n8n can only surface what the backend actually tracks.

## Coverage of other key methodologies

| Methodology | Status | Notes |
| ----------- | ------ | ----- |
| **Agile (umbrella)** | ✅ | Covered by the Kanban + Scrum views (grouped under "Agile"). |
| **Kanban / Lean** | ✅ | Kanban view with WIP limits. |
| **Scrum** | ✅ | Sprint board, backlog, burndown, velocity. |
| **Waterfall** | ✅ | The Gantt view is a time-phased waterfall schedule. |
| **Critical Path (CPM)** | ◐ | Gantt shows the schedule; explicit dependency/critical-path calc is a roadmap item (needs a `dependsOn` field via n8n). |
| **PRINCE2** | ✅ | Management stages + highlight report (RAG, exceptions, tolerance breach). |
| **PMBOK / PMI** | ◐ | Process-group framing maps onto stages; the EVM **Reports** page already covers cost/schedule performance (CPI/SPI). |
| **Six Sigma (DMAIC)** | ◐ | Reuses the stage view with `stage:Define|Measure|Analyze|Improve|Control` labels. |
| **SAFe (scaled agile)** | ☐ | Program/PI board needs multi-team + epic data; roadmap (the portfolio Reports view is the current rollup). |
| **Extreme Programming (XP)** | ◐ | Use the Scrum/Kanban views; XP practices are process, not a distinct board. |

✅ built-in · ◐ partial / via labels · ☐ roadmap

## Adding a new view (the plumbing)

A view is just a component that takes `{ projectId }`. To add one:

1. **Build the component** under `artifacts/omniproject/src/components/views/`
   (fetch with `useGetProjectIssues(projectId)`; derive what you need with the
   helpers in `src/lib/methodology.ts`).
2. **Register metadata** — add an entry to `VIEWS` in `src/lib/views.ts` (id,
   label, group, methodology, description) and the `ViewId` union.
3. **Wire the component** — add `id → Component` to `VIEW_COMPONENTS` in
   `src/components/views/registry.ts`.

That's it — the switcher, the `Cmd+K` palette, persistence, and the dashboard
picker all pick it up automatically. No gateway or schema change is required for
a view that reads existing issue data; if it needs new fields, add them to
`openapi.yaml`, run codegen, and have n8n populate them.

See also: [TECHNICAL.md](TECHNICAL.md) · [README](../README.md).
