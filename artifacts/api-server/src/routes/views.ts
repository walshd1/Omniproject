import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { requireRole } from "../lib/rbac";

/**
 * Saved views — named filter/sort/column/grouping presets. SHARED, customer-level presentation
 * config (they ride the config-bundle snapshot/export). Any authenticated user may READ them, but
 * WRITES are gated to `pmo` (matching the sibling shared-config collections — custom-reports,
 * content-pages, report-overrides, portfolio-priority-weights) so a read-only viewer/API token
 * can't overwrite shared team config. Never project data; admin-only `PATCH /settings` not needed.
 */
export default settingsCollectionRouter({
  path: "/views",
  settingsKey: "savedViews",
  responseKey: "views",
  versionLabel: "saved views updated",
  writeGuards: [requireRole("pmo")],
});
