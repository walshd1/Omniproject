import { Router } from "express";
import { requireCollectionEdit } from "../lib/collection-edit-policy";
import { getSettings } from "../lib/settings";
import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { budgetPeriodRows } from "../lib/budget-plan";
import { rollup, parseRollupQuery } from "../lib/rollup";

/**
 * Multi-year / period budget-plan store (the planning side of financials). GET/PUT the JSON plans (manager+),
 * plus an artifact-agnostic ROWS endpoint: the raw period rows, or — with a `?groupBy=…&metric=…` spec —
 * rolled up through the ONE generic `rollup` (e.g. `?groupBy=year&metric=sum:amount`). Same pattern as every
 * other output: rows → generic roll-up → rendered on the fly by a JSON def + primitives. No bespoke aggregation.
 */
const router = Router();

router.get("/budget-plans/rows", (req, res) => {
  const rows = budgetPeriodRows(getSettings().budgetPlans ?? []);
  const spec = parseRollupQuery(req.query as Record<string, unknown>);
  res.json({ rows: spec ? rollup(rows, spec) : rows });
});

router.use(settingsCollectionRouter({
  path: "/budget-plans",
  settingsKey: "budgetPlans",
  versionLabel: "budget plans updated",
  writeGuards: [requireCollectionEdit("budgetPlans", "manager")],
}));

export default router;
