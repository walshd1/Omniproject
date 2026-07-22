import { Router } from "express";
import { requireCollectionEdit } from "../lib/collection-edit-policy";
import { getSettings } from "../lib/settings";
import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { allocationRows, type ResourceAllocation } from "../lib/resource-allocation";
import { filterRowsByProjectScope } from "../lib/project-scope";
import { rollup, parseRollupQuery } from "../lib/rollup";

/**
 * Resource allocation / booking store (the write side of resource management). GET/PUT the JSON allocations
 * (manager+), plus an artifact-agnostic ROWS endpoint: the raw booking rows, or — with a `?groupBy=…&metric=…`
 * spec — rolled up through the ONE generic `rollup` (e.g. `?groupBy=resource&metric=sum:hours`). Same pattern
 * as every other output: rows → generic roll-up → rendered on the fly by a JSON def + primitives. No bespoke
 * aggregation.
 */
const router = Router();

router.get("/resource-allocations/rows", async (req, res) => {
  // Each row is per-project staffing PII — only expose the caller's in-scope allocations.
  const scoped = await filterRowsByProjectScope(req, getSettings().resourceAllocations ?? [], (a: ResourceAllocation) => a.projectId);
  const rows = allocationRows(scoped);
  const spec = parseRollupQuery(req.query as Record<string, unknown>);
  res.json({ rows: spec ? rollup(rows, spec) : rows });
});

router.use(settingsCollectionRouter({
  path: "/resource-allocations",
  settingsKey: "resourceAllocations",
  versionLabel: "resource allocations updated",
  writeGuards: [requireCollectionEdit("resourceAllocations", "manager")],
  scopeByProject: (r) => (r as ResourceAllocation).projectId,
}));

export default router;
