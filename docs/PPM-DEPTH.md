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
| M2 | **Skills-based demand/capacity** — skills matrix + role/skill-matched demand vs capacity, unmet-demand gap | Clarity / Planview resource mgmt | ▶ next |
| M6 | **Timesheets** — weekly entry + submit→approve, actuals feeding utilisation/EVM (overlay: brokered) | Clarity / Sciforma timesheets | ▶ next |
| M3 | **Stage-gate lifecycle** — configurable phase-gates, criteria/checklists, go/kill/hold, review-board approvals | Sciforma / Clarity phase-gate | ▶ next |
| M5 | **SAFe PI-planning board** — PI/iteration model, team load vs capacity, cross-team dependency board | Jira Align PI planning | ▶ next |

## M1 — Portfolio optimiser (shipped)

`lib/portfolio-optimiser.ts`. The step beyond `autoFundByRank`: rank/density greedy is provably
sub-optimal for the 0/1 knapsack it's really solving, so this computes the genuinely-optimal
selection. Exact DP on budget (also yields the **efficient frontier** — value at every budget level);
an exact 2-D DP when a capacity cap is also set and the grid is tractable, else a density-greedy +
local-search pass (reported as `heuristic` so a bounded result is never mistaken for exact).
Must-fund / forbid locks. Wired as **"Optimise (max value)"** in the Portfolio Prioritisation report,
next to the greedy auto-fund, reporting the value uplift.

## M4 — OKR / strategy cascade (shipped)

`lib/strategy-cascade.ts`. Builds the theme→objective→key-result→initiative tree from the canonical
strategy fields (strategicTheme / objectives / kpis / strategicContribution). Objective progress rolls
up as a **contribution-weighted mean** of its initiatives; key results parse `name: actual/target`
into attainment %; initiatives citing no objective are surfaced as **unaligned investment** with a
coverage %. Rendered as an **OKR cascade** panel in the Strategy Alignment report.

## Posture

All six stay true to the stateless overlay: the analytics ones derive live from the portfolio the
gateway already reads; the workflow ones (stage-gate, timesheets, PI planning) hold their state below
the seam / broker to the backend. Each is governable through the existing report/feature catalogue.
