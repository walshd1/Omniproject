import { settingsCollectionRouter } from "../lib/settings-collection-router";

/**
 * Saved views — named filter/sort/column/grouping presets a user can switch between. They are
 * SHARED, customer-level presentation config (they ride the config-bundle snapshot/export), so any
 * authenticated user may read and save them — like a team's shared filters. Benign presentation
 * config, never project data; admin-only `PATCH /settings` is not required.
 */
export default settingsCollectionRouter({
  path: "/views",
  settingsKey: "savedViews",
  responseKey: "views",
  versionLabel: "saved views updated",
});
