import { settingsCollectionRouter } from "../lib/settings-collection-router";

/**
 * Custom dashboards — named, ordered collections of widget instances a user composes from the
 * widget catalogue. Like saved views, these are SHARED, customer-level presentation config (they
 * ride the config-bundle snapshot/export), so any authenticated user may read and save them.
 * Benign presentation config, never project data; admin-only `PATCH /settings` is not required.
 */
export default settingsCollectionRouter({
  path: "/dashboards",
  settingsKey: "dashboards",
  versionLabel: "dashboards updated",
});
