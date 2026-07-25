import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { requireRole } from "../lib/rbac";
import { shapeChecked, validateSavedViews } from "../lib/settings";

/**
 * Saved views — named filter/sort/column/grouping presets. SHARED, customer-level presentation
 * config, held as a scope-layered `saved-views` config def (NOT a settings key). Any authenticated
 * user may READ them, but WRITES are gated to `pmo` (matching the sibling shared-config collections)
 * so a read-only viewer/API token can't overwrite shared team config. Never project data.
 */
export default settingsCollectionRouter({
  path: "/views",
  responseKey: "views",
  configId: "saved-views", // config-def-backed (CHOICE) — no longer a settings key
  validate: shapeChecked(validateSavedViews),
  versionLabel: "saved views updated",
  writeGuards: [requireRole("pmo")],
});
