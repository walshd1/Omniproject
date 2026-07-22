import type { Request, Response } from "express";
import { hasRole } from "./rbac";
import { guardProjectScope, guardProgrammeScope } from "./project-scope";
import { getArtifact, putArtifact, artifactStoreEnabled, type ScopedTarget } from "./artifact-store";
import { resolveConfig } from "./scoped-config";

/**
 * DEFINITION SCOPE POLICY — the admin-configurable answer to "who may WRITE a definition at each scope". The
 * ENFORCEMENT (the gate comparisons, `authorizeDefWrite`) is code; the POLICY LEVELS (which role each scope
 * needs) are DATA: the baseline ships as a system `config` def (`def-scope-policy`, seeded into the read-only
 * system store) and is resolved with the usual copy-and-override — an org may override it (per key) via the
 * sealed store, nearest scope winning. The compiled {@link DEFAULT_DEF_SCOPE_POLICY} is only a FAIL-SAFE for
 * when the store is unavailable (security fails closed). Reads stay at scoped viewer+; this gates writes.
 */

/** A write gate for one scope. `pmoOrAdmin` means either orthogonal authority (a plain manager is NOT enough);
 *  `programmeManager` is the scoped rung between manager and the authorities (which also clear it). */
export type DefGate = "contributor" | "manager" | "programmeManager" | "pmoOrAdmin" | "admin";
export const DEF_GATES: readonly DefGate[] = ["contributor", "manager", "programmeManager", "pmoOrAdmin", "admin"];

export interface DefScopePolicy {
  user: DefGate;
  project: DefGate;
  programme: DefGate;
  org: DefGate;
}

/** The logical id of the system-JSON config def carrying the policy levels (scope-overridable, copy-and-override). */
export const DEF_SCOPE_POLICY_CONFIG_ID = "def-scope-policy";

/** FAIL-SAFE defaults (used only when the store is unavailable): user → any author; project → PM (manager);
 *  programme → programmeManager; org → PMO or admin. The AUTHORITATIVE baseline is the seeded system config def. */
export const DEFAULT_DEF_SCOPE_POLICY: DefScopePolicy = { user: "contributor", project: "manager", programme: "programmeManager", org: "pmoOrAdmin" };

const POLICY_TYPE = "def-policy";
const POLICY_ID = "policy";
const ORG_SCOPE = { kind: "org" } as const;

const isGate = (v: unknown): v is DefGate => typeof v === "string" && (DEF_GATES as readonly string[]).includes(v);

/** Coerce a resolved policy object to valid gates, falling back to the fail-safe per key. */
function coercePolicy(p: Partial<Record<keyof DefScopePolicy, unknown>>): DefScopePolicy {
  return {
    user: isGate(p.user) ? p.user : DEFAULT_DEF_SCOPE_POLICY.user,
    project: isGate(p.project) ? p.project : DEFAULT_DEF_SCOPE_POLICY.project,
    programme: isGate(p.programme) ? p.programme : DEFAULT_DEF_SCOPE_POLICY.programme,
    org: isGate(p.org) ? p.org : DEFAULT_DEF_SCOPE_POLICY.org,
  };
}

/** Does the request satisfy a scope gate? */
export function satisfiesDefGate(req: Request, gate: DefGate): boolean {
  switch (gate) {
    case "contributor": return hasRole(req, "contributor");
    case "manager": return hasRole(req, "manager");
    case "programmeManager": return hasRole(req, "programmeManager");
    case "pmoOrAdmin": return hasRole(req, "pmo") || hasRole(req, "admin");
    case "admin": return hasRole(req, "admin");
  }
}

/**
 * The current policy: the system-JSON baseline (the seeded `def-scope-policy` config def), copy-and-overridden by
 * the org's stored policy (per key). Falls back to the compiled fail-safe only when the store is disabled.
 */
export function getDefScopePolicy(): DefScopePolicy {
  if (!artifactStoreEnabled()) return { ...DEFAULT_DEF_SCOPE_POLICY };
  // Baseline from system JSON (system → org config-def layers folded over the fail-safe), then the explicit
  // org policy artifact overrides per key — the usual copy-and-override.
  const base = coercePolicy(resolveConfig<Partial<DefScopePolicy>>(DEF_SCOPE_POLICY_CONFIG_ID, DEFAULT_DEF_SCOPE_POLICY, {}));
  const row = getArtifact<{ id: string } & Partial<DefScopePolicy>>(POLICY_TYPE, ORG_SCOPE, POLICY_ID);
  if (!row) return base;
  return {
    user: isGate(row.user) ? row.user : base.user,
    project: isGate(row.project) ? row.project : base.project,
    programme: isGate(row.programme) ? row.programme : base.programme,
    org: isGate(row.org) ? row.org : base.org,
  };
}

/** Merge a partial patch over the current policy and persist it (org config). Unknown gate values are ignored. */
export function setDefScopePolicy(patch: unknown): DefScopePolicy {
  const current = getDefScopePolicy();
  const p = (patch ?? {}) as Record<string, unknown>;
  const next: DefScopePolicy = {
    user: isGate(p["user"]) ? p["user"] : current.user,
    project: isGate(p["project"]) ? p["project"] : current.project,
    programme: isGate(p["programme"]) ? p["programme"] : current.programme,
    org: isGate(p["org"]) ? p["org"] : current.org,
  };
  putArtifact(POLICY_TYPE, ORG_SCOPE, { id: POLICY_ID, ...next });
  return next;
}

/**
 * WRITE authorization for a def op at a storage target: the configured per-scope gate, plus the caller's
 * project scope for `project`. Returns true when allowed; otherwise it has ALREADY sent the response
 * (403/400) and the caller must return.
 */
export async function authorizeDefWrite(req: Request, res: Response, storage: ScopedTarget, ids: { projectId?: string | undefined; programmeId?: string | undefined }): Promise<boolean> {
  const policy = getDefScopePolicy();
  const deny = (gate: DefGate, what: string): boolean => { res.status(403).json({ error: `writing ${what} requires ${gate}` }); return false; };
  switch (storage) {
    case "user":
      return satisfiesDefGate(req, policy.user) ? true : deny(policy.user, "to your area");
    case "project":
      if (!ids.projectId) { res.status(400).json({ error: "a project definition needs a projectId" }); return false; }
      if (!satisfiesDefGate(req, policy.project)) return deny(policy.project, "a project definition");
      return guardProjectScope(req, res, ids.projectId);
    case "programme":
      if (!ids.programmeId) { res.status(400).json({ error: "a programme definition needs a programmeId" }); return false; }
      // The gate (programmeManager by default; pmo/admin clear it) AND that programme's row-scope, so a
      // programme manager's def is confined to a programme they own.
      if (!satisfiesDefGate(req, policy.programme)) return deny(policy.programme, "a programme definition");
      return guardProgrammeScope(req, res, ids.programmeId);
    case "org":
      return satisfiesDefGate(req, policy.org) ? true : deny(policy.org, "an org-wide definition");
    case "sidecar":
      res.status(400).json({ error: "the definition importer does not support the sidecar target" });
      return false;
  }
}
