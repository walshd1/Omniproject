import { Router } from "express";
import { normalisedBy } from "../lib/settings";
import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { readConfigCollection } from "../lib/scoped-config";
import { requireCollectionEdit } from "../lib/collection-edit-policy";
import { raciRows, validateRaci, RaciError, type RaciEntry } from "../lib/raci";
import { rollup, parseRollupQuery } from "../lib/rollup";

/**
 * RACI register store. GET/PUT the JSON entries (manager+), plus the artifact-agnostic ROWS endpoint (raw
 * rows, or a `?groupBy=…&metric=…` roll-up through the ONE generic `rollup`) the RACI screen's table binds
 * to. Same pattern as budget-plans / resource-allocations.
 */
const router = Router();

router.get("/raci/rows", (req, res) => {
  const rows = raciRows(readConfigCollection<RaciEntry[]>("raci", []));
  const spec = parseRollupQuery(req.query as Record<string, unknown>);
  res.json({ rows: spec ? rollup(rows, spec) : rows });
});

router.use(settingsCollectionRouter({
  path: "/raci",
  responseKey: "raci",
  configId: "raci", // config-def-backed (CHOICE) — no longer a settings key
  validate: normalisedBy((v) => validateRaci(v), RaciError),
  versionLabel: "raci updated",
  // Default user-editable (contributor+); an admin/PMO can raise or lock it via collectionEditRoles.
  writeGuards: [requireCollectionEdit("raci", "contributor")],
}));

export default router;
