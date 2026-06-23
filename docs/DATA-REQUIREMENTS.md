# Data Requirements & Dependencies

What each view and report needs from the **underlying system(s)**, and what it
does when that data isn't available.

> **Core principle:** OmniProject renders only what n8n returns, and **n8n can
> only return what the backend exposes.** If a system doesn't *track* a data
> domain (resources, costs, baselines, blockers), n8n cannot synthesize it — the
> dependent view degrades or shows an explicit "not available" state. Wiring the
> n8n webhook is necessary but **not sufficient**; the backend must actually hold
> the data.

---

## 1. Required vs optional core fields

The board/list/timeline views are driven by `list_issues` / `list_projects`.

| Field | Needed for | If missing |
| ----- | ---------- | ---------- |
| `id`, `title`, `status` | everything | — (mandatory) |
| `priority` | priority dots, story-point weighting | treated as `none` |
| `startDate` / `dueDate` | **Gantt** bars, overdue, sprint bucketing, PRINCE2 milestones | Gantt shows "no scheduled issues"; no overdue/exception flags |
| `assignee` | who's doing the work; **prerequisite for resource reporting** | shown as "—"; resource rollups impossible |
| `labels` | `sprint:` / `stage:` / `sp:` derivations | falls back to status-based sprint/stage and priority-weighted points |

So the Kanban, List, Scrum, and PRINCE2 views always render (with fallbacks), but
their **fidelity** depends on scheduling dates, assignees, and labels existing in
the backend.

---

## 2. Reports — hard data dependencies

These three reports each depend on a **data domain a basic issue tracker may not
have**. This is where "if n8n can't see it, it can't populate it" bites.

### Resource Heatmap — `get_resource_capacity`

Requires **resource / capacity management** data:

| Output field | Source data required | Provided by |
| ------------ | -------------------- | ----------- |
| `resourceName`, `role` | a people / role directory | HR/IdP directory, or the backend's user + role model |
| `assignedHours` | task **estimates** or **time bookings** per person | estimates (story points/hours) or time tracking |
| `availableHours` | person **capacity** (FTE × working days − leave) | a resource/capacity module or HR calendar |
| `allocationPercentage`, `utilizationState` | `assignedHours / availableHours` | computed by n8n from the above |

**Dependency:** a plain tracker (e.g. Plane, or Jira without Tempo/Advanced
Roadmaps) does **not** track availability/allocation — n8n has nothing to return,
and the heatmap shows *"requires a resource-management source."* Populate it from
e.g. **Jira + Tempo/Plans**, **OpenProject** (with the resources module),
**TaskJuggler**, **MS Dynamics 365 BC Jobs**, or **SAP**.

### Financial EVM — `get_project_financials`

Requires a **cost / ERP source** *and* a **baseline**:

| Output field | Source data required |
| ------------ | -------------------- |
| `budgetAllocated` (BAC) | project budget — finance/ERP system |
| `actualBurn` (AC) | actual cost = time/expenses × rates — timesheets + ERP |
| `earnedValue` (EV) | % complete × budget — progress measure + budget |
| `cpi` (EV/AC), `spi` (EV/PV) | requires **planned value (PV)** = baseline schedule × budget |
| `forecastCostAtCompletion` (EAC) | computed from BAC/CPI |

**Dependency:** without a budget/cost source there is no EVM — the chart shows
*"requires a cost/ERP source."* Provide from **Dolibarr**, **Odoo CE**, **SAP
S/4HANA**, or **Dynamics 365**. CPI/SPI additionally need a **saved baseline**
(planned dates + planned spend); current-state-only backends can supply BAC/AC/EV
but not a true SPI.

### Portfolio Health — `get_portfolio_health`

A composite rollup that inherits the dependencies above:

| Output field | Depends on |
| ------------ | ---------- |
| `scheduleVarianceDays` | a **schedule baseline** (planned vs current dates) |
| `budgetVariancePercentage` | a **finance source** (budget vs actuals) |
| `activeBlockersCount` | **blocker/dependency** data — issue-link types ("blocks"), a flag, or a `blocked` label |
| `ragStatus` | n8n's rollup of the above |

Where a feeding domain is absent, n8n should omit/zero that metric (and the RAG
should reflect reduced confidence) rather than fabricate it.

---

## 3. Dependency matrix (at a glance)

| View / report | Scheduling dates | Assignees | Resource capacity | Cost / budget | Baseline | Blockers/links |
| ------------- | :--: | :--: | :--: | :--: | :--: | :--: |
| Kanban / List | ○ | ○ | – | – | – | – |
| Scrum | ○ (sprints) | ○ | – | – | – | – |
| Gantt | **●** | ○ | – | – | ○ | ○ |
| PRINCE2 | ○ | ○ | – | – | ○ | ○ |
| Portfolio KPI | ○ | – | – | ● | ● | ● |
| Resource Heatmap | – | **●** | **●** | – | – | – |
| Financial EVM | – | – | – | **●** | ● (SPI) | – |

**●** required · ○ enriches · – not used

---

## 4. Backend capability map

What to wire for each data domain:

| Domain | Examples that provide it |
| ------ | ------------------------ |
| Issues, status, dates | Plane, OpenProject, Jira, Azure DevOps, GitHub, ServiceNow |
| Resource capacity/allocation | Jira + Tempo/Plans, OpenProject (resources), TaskJuggler, Dynamics 365 BC, SAP |
| Cost / budget (EVM) | Dolibarr, Odoo CE, SAP S/4HANA, Dynamics 365 |
| Schedule baseline | OpenProject baselines, MS Project, Primavera, a stored plan |
| Blockers / dependencies | issue-link types ("blocks"), a `blocked` flag/label |

A single OmniProject instance can **federate several** of these — e.g. issues
from Jira, capacity from Tempo, financials from SAP — because n8n composes the
response per action. The `X-OmniProject-Source` header on each action
(`capacity_engine`, `financial_ledger`, `portfolio_master`) lets your workflow
route to the right system.

---

## 5. Graceful degradation (current behaviour)

- **Gantt** with no dates → "No scheduled issues."
- **Resource Heatmap** with no capacity data → explicit "requires a
  resource-management source" message.
- **Financial EVM** with no budget → explicit "requires a cost/ERP source" message.
- **Scrum / PRINCE2** always render via status fallbacks; attach `sprint:` /
  `stage:` / `sp:` labels (in n8n) to make them authoritative.

**Recommended (roadmap):** have n8n return a lightweight *capabilities* signal so
the UI can pre-emptively label which reports are available for a given backend,
rather than discovering it per request.

See also: [METHODOLOGIES.md](METHODOLOGIES.md) · [TECHNICAL.md](TECHNICAL.md).
