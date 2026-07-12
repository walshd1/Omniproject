import { requireRole } from "../lib/rbac";
import { settingsCollectionRouter } from "../lib/settings-collection-router";

/**
 * The admin/PMO-managed programme registry: programmeId → { name, instanceIds }. Membership is defined
 * here (by project correlation GUID), and the display name is whatever an admin/PMO chooses. Read by any
 * authenticated session (the programme UI renders from it); authoring is gated to PMO and above. Sealed
 * at rest with the rest of settings.
 */
export default settingsCollectionRouter({
  path: "/programme-registry",
  settingsKey: "programmeRegistry",
  versionLabel: "programme registry updated",
  default: {},
  writeGuards: [requireRole("pmo")],
});
