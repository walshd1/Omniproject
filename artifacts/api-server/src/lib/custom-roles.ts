/**
 * ADMIN-DEFINED CUSTOM ROLES + PERMISSION SETS. An org can name its own roles ("Finance Analyst", "Delivery
 * Lead") and permission bundles — but SAFELY: a custom role is always GROUNDED in one of the six fixed base
 * roles, so it can never confer more than that base role's statically-verifiable grants (an admin could
 * already grant that base via the role-map; this only labels + bundles it). A PERMISSION SET is a named bundle
 * of governance CAPABILITY ids; a custom role references zero or more of them. Custom roles carry the IdP
 * groups that confer them (resolution wired separately). Stored org-wide in the sealed store.
 *
 * PURE: validation + normalisation here (`sanitizeCustomRolesConfig`); the route persists via `artifact-store`.
 */
import { getArtifact, putArtifact, artifactStoreEnabled, type ArtifactScope } from "./artifact-store";
import { ROLES, type Role } from "./rbac";
import { getCapability } from "./capability-governance";

/** A named bundle of governance capability ids. */
export interface PermissionSet {
  id: string;
  label: string;
  description: string;
  /** Governance capability ids this set grants (validated against the capability catalogue). */
  capabilities: string[];
}

/** An admin-defined role: a label + a FIXED base role (the hard grant ceiling) + permission sets + the IdP
 *  groups that confer it. */
export interface CustomRole {
  id: string;
  label: string;
  description: string;
  /** The fixed base role this custom role resolves to (never exceeds it). */
  baseRole: Role;
  /** Permission sets this role includes (by id). */
  permissionSetIds: string[];
  /** IdP groups/claims that confer this custom role. */
  groups: string[];
}

export interface CustomRolesConfig {
  permissionSets: PermissionSet[];
  customRoles: CustomRole[];
}

export const CUSTOM_ROLES_DEFAULT: CustomRolesConfig = { permissionSets: [], customRoles: [] };

/** A custom role can be grounded in any fixed role EXCEPT `guest` (the invite-only floor is never a target). */
export const CUSTOM_ROLE_BASES: readonly Role[] = ROLES.filter((r) => r !== "guest");

const CUSTOM_ROLES_ARTIFACT = "custom-roles";
const CUSTOM_ROLES_ID = "config";
const ORG_SCOPE: ArtifactScope = { kind: "org" };

/** A rejected custom-roles config (→ 400). */
export class CustomRolesError extends Error {
  constructor(message: string) { super(message); this.name = "CustomRolesError"; }
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIXED_ROLE_SET = new Set<string>(ROLES);
const BASE_SET = new Set<string>(CUSTOM_ROLE_BASES);
const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

function cleanGroups(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const g of raw) {
    const s = str(g, 200).toLowerCase();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Validate + normalise a whole custom-roles config. Throws {@link CustomRolesError} (→ 400). Referential
 *  integrity is enforced: every capability id must be real, and every permissionSetId must exist. */
export function sanitizeCustomRolesConfig(raw: unknown): CustomRolesConfig {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rawSets = Array.isArray(obj["permissionSets"]) ? obj["permissionSets"] : [];
  const rawRoles = Array.isArray(obj["customRoles"]) ? obj["customRoles"] : [];

  const setIds = new Set<string>();
  const permissionSets: PermissionSet[] = rawSets.map((rs, i) => {
    const s = (rs ?? {}) as Record<string, unknown>;
    const id = str(s["id"], 60);
    if (!ID_RE.test(id)) throw new CustomRolesError(`permissionSets[${i}]: id must be kebab-case`);
    if (setIds.has(id)) throw new CustomRolesError(`permissionSets[${i}]: duplicate id "${id}"`);
    setIds.add(id);
    const label = str(s["label"]);
    if (!label) throw new CustomRolesError(`permission set "${id}" needs a label`);
    const caps = Array.isArray(s["capabilities"]) ? s["capabilities"] : [];
    const capabilities: string[] = [];
    for (const c of caps) {
      const cid = str(c, 120);
      if (!getCapability(cid)) throw new CustomRolesError(`permission set "${id}" references unknown capability "${cid}"`);
      if (!capabilities.includes(cid)) capabilities.push(cid);
    }
    return { id, label, description: str(s["description"], 2000), capabilities };
  });

  const roleIds = new Set<string>();
  const customRoles: CustomRole[] = rawRoles.map((rr, i) => {
    const r = (rr ?? {}) as Record<string, unknown>;
    const id = str(r["id"], 60);
    if (!ID_RE.test(id)) throw new CustomRolesError(`customRoles[${i}]: id must be kebab-case`);
    if (FIXED_ROLE_SET.has(id)) throw new CustomRolesError(`customRoles[${i}]: "${id}" collides with a built-in role`);
    if (roleIds.has(id)) throw new CustomRolesError(`customRoles[${i}]: duplicate id "${id}"`);
    roleIds.add(id);
    const label = str(r["label"]);
    if (!label) throw new CustomRolesError(`custom role "${id}" needs a label`);
    const baseRole = str(r["baseRole"], 20);
    if (!BASE_SET.has(baseRole)) throw new CustomRolesError(`custom role "${id}" baseRole must be one of ${CUSTOM_ROLE_BASES.join(", ")}`);
    const rawIds = Array.isArray(r["permissionSetIds"]) ? r["permissionSetIds"] : [];
    const permissionSetIds: string[] = [];
    for (const p of rawIds) {
      const pid = str(p, 60);
      if (!setIds.has(pid)) throw new CustomRolesError(`custom role "${id}" references unknown permission set "${pid}"`);
      if (!permissionSetIds.includes(pid)) permissionSetIds.push(pid);
    }
    return { id, label, description: str(r["description"], 2000), baseRole: baseRole as Role, permissionSetIds, groups: cleanGroups(r["groups"]) };
  });

  return { permissionSets, customRoles };
}

/** The current custom-roles config (org artifact, or the empty default). */
export function getCustomRolesConfig(): CustomRolesConfig {
  if (!artifactStoreEnabled()) return { ...CUSTOM_ROLES_DEFAULT };
  const row = getArtifact<{ id: string } & CustomRolesConfig>(CUSTOM_ROLES_ARTIFACT, ORG_SCOPE, CUSTOM_ROLES_ID);
  if (!row) return { ...CUSTOM_ROLES_DEFAULT };
  return { permissionSets: row.permissionSets ?? [], customRoles: row.customRoles ?? [] };
}

/** Validate + persist a whole custom-roles config (org). */
export function setCustomRolesConfig(raw: unknown): CustomRolesConfig {
  const clean = sanitizeCustomRolesConfig(raw);
  putArtifact(CUSTOM_ROLES_ARTIFACT, ORG_SCOPE, { id: CUSTOM_ROLES_ID, ...clean });
  return clean;
}

/** The capabilities a set of custom-role ids grants (union of their permission sets' capabilities). Used by
 *  the resolution/enforcement layer. */
export function capabilitiesForCustomRoles(ids: string[], config: CustomRolesConfig = getCustomRolesConfig()): string[] {
  const setById = new Map(config.permissionSets.map((s) => [s.id, s]));
  const out = new Set<string>();
  for (const role of config.customRoles) {
    if (!ids.includes(role.id)) continue;
    for (const sid of role.permissionSetIds) for (const c of setById.get(sid)?.capabilities ?? []) out.add(c);
  }
  return [...out];
}

/** Resolve a set of IdP group claims to the matching custom roles (a claim matches a role's `groups`). */
export function customRolesForClaims(claims: string[], config: CustomRolesConfig = getCustomRolesConfig()): CustomRole[] {
  const claimSet = new Set(claims.map((c) => c.toLowerCase()));
  return config.customRoles.filter((r) => r.groups.some((g) => claimSet.has(g)));
}
