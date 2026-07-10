import { requireRole } from "../lib/rbac";
import { settingsCollectionRouter } from "../lib/settings-collection-router";

/**
 * Bespoke report definitions (the report generator). Customer-level presentation config — a report is a
 * data-driven definition (filter + group-by + aggregated metrics + viz), never project data, and rides
 * the snapshot/export bundle. Any authenticated user may READ them (so saved reports render for everyone);
 * authoring is PMO-gated, since a custom report is shared org config. Validated in updateSettings.
 */
export default settingsCollectionRouter({
  path: "/reports/custom",
  settingsKey: "customReports",
  versionLabel: "custom reports updated",
  writeGuards: [requireRole("pmo")],
});
