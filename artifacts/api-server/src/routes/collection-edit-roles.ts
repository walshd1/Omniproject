import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { requireAnyRole } from "../lib/rbac";

/**
 * The per-collection EDIT-policy store. An admin or PMO maps a collection to a minimum edit role (or
 * "readonly") — e.g. "only manager+ may edit RACI", or lock a register read-only. READ open (the SPA needs
 * it to show/hide edit controls); WRITE gated to admin OR pmo, the authorities that own screen RBAC.
 */
export default settingsCollectionRouter({
  path: "/collection-edit-roles",
  settingsKey: "collectionEditRoles",
  versionLabel: "collection edit roles updated",
  default: {},
  writeGuards: [requireAnyRole("admin", "pmo")],
});
