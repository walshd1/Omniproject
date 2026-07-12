import { requireRole } from "../lib/rbac";
import { settingsCollectionRouter } from "../lib/settings-collection-router";

/**
 * Admin-defined custom fields that EXTEND the reference superset. Read by any authenticated session
 * (they must render for everyone); authoring is admin-gated. `updateSettings` validates the shape AND
 * the source rule — each custom field must be mapped in the routing matrix or held by the built-in
 * backend — so a field with no data source is a 400. Definitions are sealed at rest with the rest of
 * settings (config-store), i.e. the encrypted JSON.
 */
export default settingsCollectionRouter({
  path: "/custom-fields",
  settingsKey: "customFields",
  versionLabel: "custom fields updated",
  writeGuards: [requireRole("admin")],
});
