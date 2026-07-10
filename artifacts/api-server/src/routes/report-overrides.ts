import { requireRole } from "../lib/rbac";
import { settingsCollectionRouter } from "../lib/settings-collection-router";

/**
 * Metadata overrides for the built-in (catalogue) reports. Presentation-only: a per-report-id override of
 * label / order / visibility, merged over the shipped catalogue on the client so a customer can rename,
 * reorder or hide a built-in report without a rebuild. Never changes rendering (that's code) or data.
 * Any authenticated user may READ (so the overrides apply for everyone); authoring is PMO-gated, since it
 * is shared org config. Validated in updateSettings.
 */
export default settingsCollectionRouter({
  path: "/reports/overrides",
  settingsKey: "reportOverrides",
  versionLabel: "report overrides updated",
  writeGuards: [requireRole("pmo")],
});
