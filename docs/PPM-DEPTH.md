# PPM depth — gap closure against best-in-class

OmniProject is already enterprise-competitive in **breadth** (44 report surfaces, 41 backend
integrations, full EVM/benefits/resource/agile analytics, org→programme→project governance). A depth
review against the top-tier suites (Planview, Broadcom Clarity, Planisware, Sciforma, Jira Align)
found **six** modules where the leaders still go deeper. This initiative closes all six; each is a
pure, stateless, tested module consistent with the overlay posture (nothing stored in the gateway).

| # | Module | Best-in-class benchmark | Status |
| --- | --- | --- | --- |
| M1 | **Portfolio optimiser** — value-max project mix under budget+capacity (0/1 knapsack + efficient frontier) | Planview / Planisware portfolio optimisation | ✅ shipped |
| M4 | **OKR / strategy cascade** — theme→objective→key-result→initiative tree, contribution-weighted rollup, alignment coverage | Jira Align / Planview OKR cascade | ✅ shipped |
| M2 | **Skills-based demand/capacity** — skills matrix + role/skill-matched demand vs capacity, unmet-demand gap | Clarity / Planview resource mgmt | ✅ shipped |
| M6 | **Timesheets** — weekly entry + submit→approve, actuals feeding utilisation/EVM (overlay: brokered) | Clarity / Sciforma timesheets | ✅ shipped |
| M3 | **Stage-gate lifecycle** — configurable phase-gates, criteria/checklists, go/kill/hold, review-board approvals | Sciforma / Clarity phase-gate | ✅ shipped |
| M5 | **SAFe PI-planning board** — PI/iteration model, team load vs capacity, cross-team dependency board | Jira Align PI planning | ✅ shipped |

**All six gaps are now closed.**

## M1 — Portfolio optimiser

`lib/portfolio-optimiser.ts`. Beyond `autoFundByRank`: rank/density greedy is provably sub-optimal for
the 0/1 knapsack it solves, so this computes the genuinely-optimal selection. Exact DP on budget (also
yields the **efficient frontier**); exact 2-D DP when a capacity cap is set and tractable, else
density-greedy + local search (reported `heuristic`). Must-fund / forbid locks. Wired as **"Optimise
(max value)"** in the Portfolio Prioritisation report.

## M4 — OKR / strategy cascade

`lib/strategy-cascade.ts`. Theme→objective→key-result→initiative tree from the canonical strategy
fields; contribution-weighted objective rollup; parsed key results (`name: actual/target`); unaligned
investment + coverage %. Rendered as an **OKR cascade** panel in Strategy Alignment.

## M2 — Skills-based demand/capacity

`lib/skills-capacity.ts` + `SkillsCapacity` component. Matches role/skill-qualified supply against
demand requests (proficiency-bar aware, senior-first) and surfaces the **unmet gap by skill** plus
per-resource over-allocation. **Data source (wired):** skills aren't a canonical field, so the matrix
+ demand are PLANNING CONFIG in `settings.skillsPlanning` (like rate cards / priority weights) — read
via `useSkillsPlanning`, admin/PMO edited, riding the snapshot. Rendered in the Utilisation report.

## M6 — Timesheets

`lib/timesheet.ts` + `TimesheetPanel` component. Weekly time entry + a **submit → approve/reject →
reopen** state machine with segregation-of-duties (no self-approval), and an actuals rollup
(`timesheetActualsByProject`) that feeds utilisation / EVM `loggedHours`. **Data source (wired):**
timesheets are transactional at-rest data, so they persist BELOW the seam via a resolved
`TimesheetStore` — the self-host DB when adoption is on, and/or a 3rd-party backend when it supports
timesheets and it's enabled. The gateway holds nothing: `/api/timesheets` enforces the authoritative
state machine + RBAC (owner submits; manager+ approves; never self-approve) and delegates load/save to
the store; when none is configured it answers an honest 409. Surfaced in the My Work page via
`TimesheetReview`; the concrete store impls (self-host / broker) are injected at boot like the
retention source.

**Staff-cost actuals (wired):** approved timesheets feed the internal staff-cost figure.
`timesheets/actuals.ts` sums **approved** hours per resource for a project (draft/submitted excluded)
and turns them into synthetic internal-time items, which flow through the same `staffCost` math (rate
card + hashed identity map) as the backend-logged cost. The staff-cost endpoint returns this as
`timesheetActuals` **alongside** the logged cost (never replacing it) when a timesheet store is
resolved, so the PMO can compare "what the tracked, approved time actually cost" to logged effort.
Rendered as a *Timesheet actuals* card in the Staff Time & Cost report. Nothing is stored — it reads
the store below the seam and derives live.

## M3 — Stage-gate lifecycle

`lib/stage-gate.ts` + `StageGatePanel` component. A project advances through an ordered, configurable
gate lifecycle; each gate has **entry criteria** + a **required number of review-board go-approvals**,
and ends in a **go / kill / hold** decision. The state machine enforces the guards — a gate can't be
passed until its criteria are met AND it has the required distinct go-votes; kill is terminal; hold
records but stays. State is brokered; the transition rules are pure and here.

## M5 — SAFe PI-planning board

`lib/pi-planning.ts` + `PiBoard` component. The ART-level board: per-team **load vs capacity** across
the PI's iterations (over-commitment flagged), the **committed-vs-stretch business-value** split, and
a **cross-team dependency board** (dependencies pointing off the ART flagged). Pure planning over the
teams / load / objectives / dependencies given.

## Posture

All modules stay true to the stateless overlay: the analytics ones (M1, M4) derive live from the
portfolio the gateway already reads; the resource/workflow ones (M2, M6, M3, M5) hold their state
below the seam / broker to the backend, with the pure decision logic in the gateway. Each is
governable through the existing report/feature catalogue.
