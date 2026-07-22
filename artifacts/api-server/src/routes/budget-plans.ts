import { Router } from "express";
import { requireCollectionEdit } from "../lib/collection-edit-policy";
import { getSettings } from "../lib/settings";
import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { budgetPeriodRows, type BudgetPlan } from "../lib/budget-plan";
import { filterRowsByProjectScope } from "../lib/project-scope";
import { rollup, parseRollupQuery } from "../lib/rollup";

/**
 * Multi-year / period budget-plan store (the planning side of financials). GET/PUT the JSON plans (manager+),
 * plus an artifact-agnostic ROWS endpoint: the raw period rows, or — with a `?groupBy=…&metric=…` spec —
 * rolled up through the ONE generic `rollup` (e.g. `?groupBy=year&metric=sum:amount`). Same pattern as every
 * other output: rows → generic roll-up → rendered on the fly by a JSON def + primitives. No bespoke aggregation.
 */
const router = Router();

router.get("/budget-plans/rows", async (req, res) => {
  // Each row is per-project financial data — only expose the caller's in-scope budget plans.
  const scoped = await filterRowsByProjectScope(req, getSettings().budgetPlans ?? [], (b: BudgetPlan) => b.projectId);
  const rows = budgetPeriodRows(scoped);
  const spec = parseRollupQuery(req.query as Record<string, unknown>);
  res.json({ rows: spec ? rollup(rows, spec) : rows });
});

router.use(settingsCollectionRouter({
  path: "/budget-plans",
  settingsKey: "budgetPlans",
  versionLabel: "budget plans updated",
  writeGuards: [requireCollectionEdit("budgetPlans", "manager")],
  scopeByProject: (r) => (r as BudgetPlan).projectId,
}));

export default router;
