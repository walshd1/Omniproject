import { requireAnyRole } from "../lib/rbac";
import { settingsCollectionRouter } from "../lib/settings-collection-router";

/**
 * The GUID translation table: oldGuid → newGuid, for relinking a project to a new correlation GUID.
 * Read by any authenticated session (resolution consults it); authoring is gated to either governance
 * authority — PMO (business) or admin (technical), since relinking a project is their call. Sealed at
 * rest with the rest of settings.
 */
export default settingsCollectionRouter({
  path: "/guid-aliases",
  settingsKey: "guidAliases",
  versionLabel: "guid aliases updated",
  default: {},
  writeGuards: [requireAnyRole("pmo", "admin")],
});
