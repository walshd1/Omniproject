import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { requireCollectionEdit } from "../lib/collection-edit-policy";
import { shapeChecked, validatePanelViews } from "../lib/settings";

/**
 * Org-saved PANEL VIEWS store. A user saves a filtered/pivoted view off a table or chart panel's control bar
 * (group + aggregation + filter selections) and it is persisted here, in the per-deployment (encrypted)
 * config store, scoped to the screen+panel it came from; the SPA then offers it back on that panel to recall
 * the view. Shared, customer-level presentation config — never project data.
 *
 * READ is open to any authenticated session (the SPA lists them). WRITES follow the same "default
 * user-editable, admin/PMO-tunable" policy as the other on-screen editable collections: a contributor+ may
 * save by default, but an admin can raise the bar or set `panelViews` read-only via collectionEditRoles.
 */
export default settingsCollectionRouter({
  path: "/panel-views",
  responseKey: "panelViews",
  configId: "panel-views", // config-def-backed (CHOICE) — no longer a settings key
  validate: shapeChecked(validatePanelViews),
  versionLabel: "panel views updated",
  writeGuards: [requireCollectionEdit("panelViews", "contributor")],
});
