import { requireRole } from "../lib/rbac";
import { settingsCollectionRouter } from "../lib/settings-collection-router";

/**
 * The field-routing matrix: which source (vendor·broker·sourceField) feeds which UI element. Read by
 * any authenticated session (so the routing applies for everyone); authoring is admin-gated, since it
 * decides where each value comes from. The anti-collision invariant (one source → one UI element,
 * both directions) is enforced in `updateSettings` → `validateFieldRouting`, so a colliding PUT is a
 * 400 and nothing persists.
 */
export default settingsCollectionRouter({
  path: "/routing",
  settingsKey: "fieldRouting",
  versionLabel: "field routing updated",
  writeGuards: [requireRole("admin")],
});
