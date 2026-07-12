import { requireAnyRole } from "../lib/rbac";
import { settingsCollectionRouter } from "../lib/settings-collection-router";

/**
 * The closed-project location registry: projectGuid → where its data now lives (sor | archive). Read by
 * any authenticated session (reports resolve source GUIDs against it); authoring is gated to either
 * governance authority — PMO (business) or admin (technical), since closing a project and choosing its
 * disposition is their call. Sealed at rest with the rest of settings.
 */
export default settingsCollectionRouter({
  path: "/closed-projects",
  settingsKey: "closedProjects",
  versionLabel: "closed-project registry updated",
  default: {},
  writeGuards: [requireAnyRole("pmo", "admin")],
});
