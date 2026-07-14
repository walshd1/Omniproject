# Data Requirements & Dependencies

What each view and report needs from the **underlying system(s)**, and what it
does when that data isn't available.

> **Core principle:** OmniProject renders only what the broker returns, and **the
> broker can only return what the backend exposes.** If a system doesn't *track* a
> data domain (resources, costs, baselines, blockers), the broker cannot
> synthesise it — the dependent view degrades or shows an explicit "not available"
> state. Wiring the broker's webhook is necessary but **not sufficient**; the
> backend must actually hold the data.

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
| `programmeId` / `programmeName` (on **projects**) | **Programmes** view — grouping related projects with a programme-wide roll-up | projects with no `programmeId` are standalone; have the broker attach these from your backend's programme/portfolio field. A programme is derived (exists only when ≥1 project references it). |

So the Kanban, List, Scrum, and PRINCE2 views always render (with fallbacks), but
their **fidelity** depends on scheduling dates, assignees, and labels existing in
the backend.

---

## 2. Reports — hard data dependencies

These three reports each depend on a **data domain a basic issue tracker may not
have**. This is where "if the broker can't see it, it can't populate it" bites.

### Resource Heatmap — `get_resource_capacity`

Requires **resource / capacity management** data:

| Output field | Source data required | Provided by |
| ------------ | -------------------- | ----------- |
| `resourceName`, `role` | a people / role directory | HR/IdP directory, or the backend's user + role model |
| `assignedHours` | task **estimates** or **time bookings** per person | estimates (story points/hours) or time tracking |
| `availableHours` | person **capacity** (FTE × working days − leave) | a resource/capacity module or HR calendar |
| `allocationPercentage`, `utilizationState` | `assignedHours / availableHours` | computed by the broker from the above |

**Dependency:** a plain tracker (e.g. Plane, or Jira without Tempo/Advanced
Roadmaps) does **not** track availability/allocation — the broker has nothing to
return, and the heatmap shows *"requires a resource-management source."* Populate it from
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
| `ragStatus` | the broker's rollup of the above |

Where a feeding domain is absent, the broker should omit/zero that metric (and the RAG
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
| Progress Trend | ○ | – | – | – | ○ | – |
| RAID Log | – | ○ | – | – | – | ○ |

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
from Jira, capacity from Tempo, financials from SAP — because the broker composes
the response per action. The `X-OmniProject-Source` header on each action
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
- **Malformed vendor rows** are repaired **once** at the always-on broker
  read-seam sanitizer (junk number → safe default, missing required string →
  `""`, enums canonicalised), so dirty data never reaches the gateway's
  derivations or the frontend — and the repair count is surfaced as a
  data-quality signal (`X-OmniProject-Data-Repaired` header / badge) rather than
  silently smoothed over.

## 6. Capabilities signal

`GET /api/capabilities` returns which data domains the wired backend(s) can
populate, so the UI labels available reports/views **before** fetching — the
Reports page shows *"Not available — requires …"* for unavailable domains, and
the view switcher tags dependent views (e.g. Gantt) as *limited* when scheduling
isn't present.

Response (`Capabilities`):

```jsonc
{
  "mode": "n8n",        // n8n | env | demo
  "issues": true, "scheduling": true, "portfolio": true,
  "resources": false, "financials": false, "baseline": false, "blockers": false,
  "history": false, "raid": false
}
```

Resolution order:

1. **`CAPABILITIES` env** (gateway-declared) — comma list of enabled domains,
   e.g. `CAPABILITIES=issues,scheduling,resources,portfolio`.
2. **Broker** action `get_capabilities` (`source: capability_probe`) — the workflow
   declares what its backends expose (see the `Capabilities (edit me)` node in
   the [n8n blueprint](../artifacts/n8n-blueprints/omniproject-core-sync.json));
   cached ~60s. Conservative defaults (core domains only) if the workflow doesn't
   implement it.
3. **Demo** — all domains on (sample data covers everything).

## 7. History, baselines & RAID — sourced, never stored

OmniProject is a **stateless overlay**: it keeps no database of its own, so the
systems of record underneath it (OpenProject, Jira, …) stay authoritative for
history and baselines. These domains are **read-through** via broker actions; if the
backend doesn't track them, the corresponding view/report reports unavailable
rather than fabricating data.

| Action (`X-OmniProject-Action`) | Source tag | Maps to (examples) | Capability |
| ------------------------------- | ---------- | ------------------ | ---------- |
| `get_project_history` | `history_provider` | OpenProject journals/activity, Jira changelog, an analytics warehouse snapshot | `history` |
| `get_baseline` | `baseline_store` | OpenProject baselines, an MS Project/Primavera saved plan | `baseline` |
| `get_raid` / `create_raid_entry` | `raid_register` | a risk register, a dedicated RAID project/board, a custom table | `raid` |
| `get_notifications` | `notification_center` | backend notifications / mentions / due-soon feeds | (always best-effort) |

Contract notes:

- **History** returns an ordered array of `{ date, completionRate, totalIssues,
  completedIssues, openBlockers?, provenance }` (oldest first). When the backend
  has no journal, return `[]`.
- **Baseline** returns a `ProjectBaseline` (`{ projectId, name?, capturedAt,
  items[], provenance }`) or **`null`** when the backend holds none.
- **RAID** writes (`create_raid_entry`) require ≥ contributor role at the gateway
  and are written to the system of record by your workflow — OmniProject does not
  retain them.

## 8. Provenance — sourced vs derived vs sample

Every analytics figure is labelled so a synthesised number is never shown as
fact (`Provenance` enum):

- **`sourced`** — read from the backend system of record via the broker.
- **`derived`** — computed by the gateway from real issue data (e.g. a trend
  reconstructed from current issue state).
- **`sample`** — demo/placeholder data; no backend wired.

The UI renders this as a badge on each report/view header (`ProvenanceBadge`).
When no provenance is present on a payload it is inferred from
`capabilities.mode` (`demo ⇒ sample`, otherwise `sourced`).

## 9. Concurrency & RBAC (write path)

- **Optimistic concurrency:** issues carry a `version` token (mirrored from the
  backend, e.g. OpenProject `lockVersion`). Updates send `expectedVersion`; a
  stale write is rejected with **409** (the current state is returned) instead of
  silently overwriting a concurrent change.
- **RBAC:** roles (`viewer` < `contributor` < `manager` < `admin`) are mapped
  from the IdP's role/group claims via `OIDC_ADMIN_ROLES` / `OIDC_MANAGER_ROLES`
  / `OIDC_CONTRIBUTOR_ROLES` / `OIDC_VIEWER_ROLES` (+ `OIDC_DEFAULT_ROLE`).
  Mutations require ≥ contributor; settings require admin. The backend still
  re-checks every brokered write using the forwarded user token, so the gateway
  gate is defence-in-depth — see [SECURITY.md](../SECURITY.md).

See also: [METHODOLOGIES.md](METHODOLOGIES.md) · [TECHNICAL.md](TECHNICAL.md) · [SECURITY.md](../SECURITY.md).
