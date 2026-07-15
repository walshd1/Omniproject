import { Router } from "express";
import { requireRole } from "../lib/rbac";
import { getSettings } from "../lib/settings";
import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { raciRows } from "../lib/raci";
import { rollup, parseRollupQuery } from "../lib/rollup";

/**
 * RACI register store. GET/PUT the JSON entries (manager+), plus the artifact-agnostic ROWS endpoint (raw
 * rows, or a `?groupBy=…&metric=…` roll-up through the ONE generic `rollup`) the RACI screen's table binds
 * to. Same pattern as budget-plans / resource-allocations.
 */
const router = Router();

router.get("/raci/rows", (req, res) => {
  const rows = raciRows(getSettings().raci ?? []);
  const spec = parseRollupQuery(req.query as Record<string, unknown>);
  res.json({ rows: spec ? rollup(rows, spec) : rows });
});

router.use(settingsCollectionRouter({
  path: "/raci",
  settingsKey: "raci",
  versionLabel: "raci updated",
  writeGuards: [requireRole("manager")],
}));

export default router;
