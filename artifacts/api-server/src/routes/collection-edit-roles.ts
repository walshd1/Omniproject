import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { requireAnyRole } from "../lib/rbac";
import { SettingsValidationError } from "../lib/settings";
import { isForbiddenKey } from "../lib/safe-json";

/**
 * The per-collection EDIT-policy store. An admin or PMO maps a collection to a minimum edit role (or
 * "readonly") — e.g. "only manager+ may edit RACI", or lock a register read-only. READ open (the SPA needs
 * it to show/hide edit controls); WRITE gated to admin OR pmo, the authorities that own screen RBAC.
 *
 * Held as a scope-layered `collection-edit-roles` config def (NOT a settings key). Read by
 * `requireCollectionEdit` (lib/collection-edit-policy).
 */

const ALLOWED_EDIT_ROLES = new Set(["viewer", "contributor", "manager", "pmo", "admin", "readonly"]);

/** Validate the edit-role map: a collection id → one of the allowed edit roles. Off settings now, so its
 *  sanitiser lives here (throws {@link SettingsValidationError} → 400 via the collection router's catch). */
export function validateCollectionEditRoles(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value == null || Array.isArray(value)) throw new SettingsValidationError("collectionEditRoles must be an object");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenKey(k)) continue;
    if (typeof v !== "string" || !ALLOWED_EDIT_ROLES.has(v)) throw new SettingsValidationError(`collectionEditRoles["${k}"] must be one of viewer, contributor, manager, pmo, admin, readonly`);
    out[k] = v;
  }
  return out;
}

export default settingsCollectionRouter({
  path: "/collection-edit-roles",
  responseKey: "collectionEditRoles",
  configId: "collection-edit-roles", // config-def-backed (CHOICE) — no longer a settings key
  validate: validateCollectionEditRoles,
  versionLabel: "collection edit roles updated",
  default: {},
  writeGuards: [requireAnyRole("admin", "pmo")],
});
