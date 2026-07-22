import { Router } from "express";
import { normalisedBy } from "../lib/settings";
import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { readConfigCollection } from "../lib/scoped-config";
import { requireCollectionEdit } from "../lib/collection-edit-policy";
import { stakeholderRows, validateStakeholders, StakeholderError, type Stakeholder } from "../lib/stakeholder";
import { rollup, parseRollupQuery } from "../lib/rollup";

/**
 * Stakeholder register store. GET/PUT the JSON entries (manager+), plus the artifact-agnostic ROWS endpoint
 * (raw rows, or a `?groupBy=…&metric=…` roll-up) the Stakeholders screen's table binds to. Same pattern as
 * budget-plans / resource-allocations.
 */
const router = Router();

router.get("/stakeholders/rows", (req, res) => {
  const rows = stakeholderRows(readConfigCollection<Stakeholder[]>("stakeholders", []));
  const spec = parseRollupQuery(req.query as Record<string, unknown>);
  res.json({ rows: spec ? rollup(rows, spec) : rows });
});

router.use(settingsCollectionRouter({
  path: "/stakeholders",
  responseKey: "stakeholders",
  configId: "stakeholders", // config-def-backed (CHOICE) — no longer a settings key
  validate: normalisedBy((v) => validateStakeholders(v), StakeholderError),
  versionLabel: "stakeholders updated",
  // Default user-editable (contributor+); an admin/PMO can raise or lock it via collectionEditRoles.
  writeGuards: [requireCollectionEdit("stakeholders", "contributor")],
}));

export default router;
