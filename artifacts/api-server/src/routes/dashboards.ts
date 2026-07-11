import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { requireRole } from "../lib/rbac";

/**
 * Custom dashboards — named, ordered collections of widget instances composed from the widget
 * catalogue. Like saved views, these are SHARED, customer-level presentation config (they ride the
 * config-bundle snapshot/export). Any authenticated user may READ them, but WRITES are gated to
 * `pmo` (matching the sibling shared-config collections) so a read-only viewer/API token can't
 * overwrite shared config. Never project data; admin-only `PATCH /settings` is not required.
 */
export default settingsCollectionRouter({
  path: "/dashboards",
  settingsKey: "dashboards",
  versionLabel: "dashboards updated",
  writeGuards: [requireRole("pmo")],
});
