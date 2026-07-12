import { requireRole } from "../lib/rbac";
import { settingsCollectionRouter } from "../lib/settings-collection-router";

/**
 * Admin-declared per-field DATA VALIDATION RULES (min/max, pattern, allowed set, required). Read by any
 * authenticated session (they inform client-side feedback); authoring is admin-gated. `updateSettings`
 * validates the rule DEFINITIONS (shape + that each pattern compiles); the rules are enforced against
 * actual values on the write path. Definitions are sealed at rest with the rest of settings.
 */
export default settingsCollectionRouter({
  path: "/field-validation",
  settingsKey: "fieldValidation",
  versionLabel: "field validation rules updated",
  writeGuards: [requireRole("admin")],
});
