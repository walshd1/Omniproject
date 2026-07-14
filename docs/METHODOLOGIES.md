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
| **RAID Log** | Risk & governance | Risks, Assumptions, Issues, Dependencies register with severity/status | backend RAID register (`get_raid`) |
| **List / Table** | neutral | Sortable table of all work items | all fields |
| **Flow (unified)** | neutral | The generic issue-engine view (list/board from the shared view engine) | `status` / all fields |

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
| **SAFe (scaled agile)** | ◐ | A selectable SAFe methodology pack ships (`assets/methodologies/safe.json` — states + PI ceremonies); only the dedicated PI-board **view** (multi-team + epic data) remains roadmap (the portfolio Reports view is the current rollup). |
| **Extreme Programming (XP)** | ◐ | Use the Scrum/Kanban views; XP practices are process, not a distinct board. |

✅ built-in · ◐ partial / via labels · ☐ roadmap

### Sector starter packs (charity / SME)

Beyond the delivery methodologies above, three ready-made "ways of working" ship as methodology
packs for charities/SMEs (selectable in the same picker):

| Pack | Shape | States |
| ---- | ----- | ------ |
| **Grant tracking** | Funder-grant lifecycle (phases + baselines + funder reporting) | prospect → drafting → submitted → under-review → awarded/declined → delivering → reporting → closed |
| **Volunteer roster** | WIP-limited shift board | available → assigned → scheduled → checked-in → completed / no-show |
| **Fundraising pipeline** | Donor pipeline (CRM-style stages) + pipeline-value reporting | lead → qualified → cultivating → ask-made → pledged → received → stewarding / lapsed |

These are data-only packs (`lib/backend-catalogue/assets/methodologies/`) — no new runtime code.

## Adding a new view (for a new methodology)

> **Is there a built-in, no-code view designer?** **No — and that's deliberate.**
> Views are **code**, not runtime configuration. There is no drag-and-drop "view
> builder", no saved-view store, and no per-tenant view records on the server.
> The reason is the core invariant: the gateway is **stateless and
> zero-data-at-rest**, so it has nowhere to persist a user-authored view
> definition. A new methodology is supported by **adding a small view component**
> (a 3-step, ~1 file change below), not by editing a database. If you do want
> *user-saved* layouts, see [Saved / user-authored views](#saved--user-authored-views).

A view is just a React component that takes `{ projectId }` and renders the
project's issues through a methodology lens. The same seven built-ins above were
each added this way; a new methodology is the same recipe.

### The 3 steps

1. **Build the component** under `artifacts/omniproject/src/components/views/`.
   Fetch with `useGetProjectIssues(projectId)` and derive your concepts from the
   neutral fields (`status`, `priority`, `labels`, `startDate`/`dueDate`,
   `assignee`, `completionPct`) using the helpers in `src/lib/methodology.ts`
   (`storyPoints`, `explicitStage`, `ragFor`, `completion`, `isOverdue`, …).
2. **Add the view definition (JSON)** — drop a view JSON under
   `lib/backend-catalogue/assets/views/`. Views are **catalogue data**, not
   hand-registered metadata: `src/lib/views.ts` builds `VIEWS` from
   `CATALOGUE_VIEWS` (`@workspace/backend-catalogue/views`). Set `needs` to the
   [capability domain](DATA-REQUIREMENTS.md) the view relies on (e.g.
   `scheduling`) so it gets auto-labelled *"limited"* when the backend can't
   populate it.
3. **Bind the renderer** — add `id → Component` to `VIEW_RENDERERS` in
   `src/components/views/view-renderers.ts` (`registry.ts` just re-exports it as
   `VIEW_COMPONENTS`).

That's it — the **view switcher**, the **`Cmd+K` palette**, **persistence** (the
chosen view is remembered per browser), and the **dashboard picker** all discover
it automatically from the metadata. No gateway or schema change is needed for a
view that reads existing issue data.

### Worked example — a "Cadence" view for a new methodology

Say a customer runs a flow-based methodology where work is grouped into named
**cadences** carried on a `cadence:<name>` label. The whole thing is one new file
plus two one-line registrations.

```tsx
// artifacts/omniproject/src/components/views/CadenceView.tsx
import { useMemo } from "react";
import { useGetProjectIssues, type Issue } from "@workspace/api-client-react";
import { completion, ragFor, isOverdue } from "../../lib/methodology";
import { DataState } from "../DataState";

const cadenceOf = (i: Issue) =>
  i.labels?.find((l) => l.startsWith("cadence:"))?.slice("cadence:".length) ?? "Unscheduled";

export function CadenceView({ projectId }: { projectId: string }) {
  const { data: issues, isLoading, isError, error, refetch } = useGetProjectIssues(projectId);

  const groups = useMemo(() => {
    const by = new Map<string, Issue[]>();
    for (const i of issues ?? []) {
      const k = cadenceOf(i);
      by.set(k, [...(by.get(k) ?? []), i]);
    }
    return [...by.entries()];
  }, [issues]);

  if (isLoading || isError || !issues)
    return <DataState isLoading={isLoading} isError={isError} error={error} onRetry={refetch}>{null}</DataState>;

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 p-4">
      {groups.map(([name, items]) => {
        const pct = completion(items);
        const overdue = items.filter(isOverdue).length;
        const rag = ragFor(pct, overdue);
        return (
          <section key={name} className="border border-border bg-card p-4">
            <h3 className="font-black uppercase tracking-tight">{name}</h3>
            <p className="text-xs text-muted-foreground">{items.length} items · {pct}% done · RAG {rag}</p>
          </section>
        );
      })}
    </div>
  );
}
```

```jsonc
// lib/backend-catalogue/assets/views/cadence.json — the view is DATA
{ "id": "cadence", "label": "Cadence Flow", "short": "Cadence", "group": "Agile",
  "methodology": "Flow / cadence-based", "kind": "board", "methodologies": ["*"],
  "description": "Work grouped by delivery cadence with RAG." }
```

```ts
// src/components/views/view-renderers.ts — bind id → Component (matched by view id)
import { CadenceView } from "./CadenceView";
// …inside VIEW_RENDERERS:
cadence: CadenceView,
```

Run `pnpm --filter @workspace/omniproject test` and the view is live in the
switcher and palette. If your methodology needs a **field the contract doesn't
carry yet**, add it to [`openapi.yaml`](../lib/api-spec/openapi.yaml), run
`pnpm --filter @workspace/api-spec run codegen`, and have your n8n workflow
populate it when it normalises issues from the backend — the field stays
broker-agnostic above the seam.

### Saved / user-authored views

If you need end-users to *save* their own layouts without a code change, do it
**without** adding server state, in one of two ways that respect the stateless
posture:

- **Session-volatile, export-to-keep** — author it client-side and let the user
  download/import a JSON bundle, exactly like the [Exploration](EXPLORATION.md)
  workspace does for snapshots and what-if scenarios. Nothing is stored at rest.
- **Persist through the broker** — model a "saved view" as just another item the
  **broker** round-trips (an n8n `save_view` / `list_views` operation against the
  backend the customer already owns). The gateway stays stateless; the data lives
  in *their* system, not OmniProject. This stays broker-agnostic by going through
  the `Broker` interface, not a new datastore.

A built-in graphical view designer is a roadmap candidate, but it would be built
on top of one of these two patterns — never by giving the gateway a database.

### Prefer to have it built for you?

The view layer is **open Apache-2.0 core and fully documented** — the recipe
above is all there is, and nothing about building a view is black-boxed. If you'd
rather not write it yourself, building a methodology view can be offered as a
**paid professional-services engagement**: you're paying for our time, not for
access. A view we build for you ships as ordinary Apache-2.0 source you own, and
the build mechanism stays open whether or not you take the service. See
[LICENSING.md → Licensed features vs. professional services](../LICENSING.md#licensed-features-vs-professional-services).

See also: [DATA-REQUIREMENTS.md](DATA-REQUIREMENTS.md) · [TECHNICAL.md](TECHNICAL.md) · [README](../README.md).
