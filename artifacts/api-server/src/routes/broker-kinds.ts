import { requireRole } from "../lib/rbac";
import { settingsCollectionRouter } from "../lib/settings-collection-router";

/**
 * The admin-managed connected-broker list: extra broker kinds wired below the seam, beyond the active
 * data hop. Read by any authenticated session; authoring is gated to admin (broker wiring is technical
 * config). Unioned with the BROKER_KINDS env in the registry, and sealed at rest with the rest of
 * settings.
 */
export default settingsCollectionRouter({
  path: "/broker-kinds",
  settingsKey: "brokerKinds",
  versionLabel: "broker list updated",
  default: [],
  writeGuards: [requireRole("admin")],
});
