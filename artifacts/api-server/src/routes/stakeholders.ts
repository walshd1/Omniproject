import { Router } from "express";
import { getSettings } from "../lib/settings";
import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { requireCollectionEdit } from "../lib/collection-edit-policy";
import { stakeholderRows } from "../lib/stakeholder";
import { rollup, parseRollupQuery } from "../lib/rollup";

/**
 * Stakeholder register store. GET/PUT the JSON entries (manager+), plus the artifact-agnostic ROWS endpoint
 * (raw rows, or a `?groupBy=…&metric=…` roll-up) the Stakeholders screen's table binds to. Same pattern as
 * budget-plans / resource-allocations.
 */
const router = Router();

router.get("/stakeholders/rows", (req, res) => {
  const rows = stakeholderRows(getSettings().stakeholders ?? []);
  const spec = parseRollupQuery(req.query as Record<string, unknown>);
  res.json({ rows: spec ? rollup(rows, spec) : rows });
});

router.use(settingsCollectionRouter({
  path: "/stakeholders",
  settingsKey: "stakeholders",
  versionLabel: "stakeholders updated",
  // Default user-editable (contributor+); an admin/PMO can raise or lock it via collectionEditRoles.
  writeGuards: [requireCollectionEdit("stakeholders", "contributor")],
}));

export default router;
