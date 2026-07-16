import type { Request, Response } from "express";
import { hasRole } from "./rbac";
import { guardProjectScope } from "./project-scope";
import { getArtifact, putArtifact, artifactStoreEnabled, type StorageTarget } from "./artifact-store";

/**
 * DEFINITION SCOPE POLICY — the admin-configurable answer to "who may WRITE a definition at each scope". The
 * defaults: a user's own private area is open to any author (`contributor`); a `project` definition needs a
 * PM (`manager`, which PMO/admin also clear); an `org`-wide definition needs `pmoOrAdmin` (either governance
 * authority). An admin can raise or relax any scope's gate — the policy itself is org-scoped config in the
 * sealed store, so a change is durable + fleet-wide. Reads stay at the scoped viewer+ visibility; this gates
 * writes/edits/deletes. Used by both the importer and the editor so the two share ONE permission model.
 */

/** A write gate for one scope. `pmoOrAdmin` means either orthogonal authority (a plain manager is NOT enough). */
export type DefGate = "contributor" | "manager" | "pmoOrAdmin" | "admin";
export const DEF_GATES: readonly DefGate[] = ["contributor", "manager", "pmoOrAdmin", "admin"];

export interface DefScopePolicy {
  user: DefGate;
  project: DefGate;
  org: DefGate;
}

/** The defaults: user → any author; project → PM (manager); org → PMO or admin. */
export const DEFAULT_DEF_SCOPE_POLICY: DefScopePolicy = { user: "contributor", project: "manager", org: "pmoOrAdmin" };

const POLICY_TYPE = "def-policy";
const POLICY_ID = "policy";
const ORG_SCOPE = { kind: "org" } as const;

const isGate = (v: unknown): v is DefGate => typeof v === "string" && (DEF_GATES as readonly string[]).includes(v);

/** Does the request satisfy a scope gate? */
export function satisfiesDefGate(req: Request, gate: DefGate): boolean {
  switch (gate) {
    case "contributor": return hasRole(req, "contributor");
    case "manager": return hasRole(req, "manager");
    case "pmoOrAdmin": return hasRole(req, "pmo") || hasRole(req, "admin");
    case "admin": return hasRole(req, "admin");
  }
}

/** The current policy (the org config artifact, or the defaults when unset / store disabled). */
export function getDefScopePolicy(): DefScopePolicy {
  const row = artifactStoreEnabled() ? getArtifact<{ id: string } & Partial<DefScopePolicy>>(POLICY_TYPE, ORG_SCOPE, POLICY_ID) : null;
  if (!row) return { ...DEFAULT_DEF_SCOPE_POLICY };
  return {
    user: isGate(row.user) ? row.user : DEFAULT_DEF_SCOPE_POLICY.user,
    project: isGate(row.project) ? row.project : DEFAULT_DEF_SCOPE_POLICY.project,
    org: isGate(row.org) ? row.org : DEFAULT_DEF_SCOPE_POLICY.org,
  };
}

/** Merge a partial patch over the current policy and persist it (org config). Unknown gate values are ignored. */
export function setDefScopePolicy(patch: unknown): DefScopePolicy {
  const current = getDefScopePolicy();
  const p = (patch ?? {}) as Record<string, unknown>;
  const next: DefScopePolicy = {
    user: isGate(p["user"]) ? p["user"] : current.user,
    project: isGate(p["project"]) ? p["project"] : current.project,
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
export async function authorizeDefWrite(req: Request, res: Response, storage: StorageTarget, projectId: string | undefined): Promise<boolean> {
  const policy = getDefScopePolicy();
  const deny = (gate: DefGate, what: string): boolean => { res.status(403).json({ error: `writing ${what} requires ${gate}` }); return false; };
  switch (storage) {
    case "user":
      return satisfiesDefGate(req, policy.user) ? true : deny(policy.user, "to your area");
    case "project":
      if (!projectId) { res.status(400).json({ error: "a project definition needs a projectId" }); return false; }
      if (!satisfiesDefGate(req, policy.project)) return deny(policy.project, "a project definition");
      return guardProjectScope(req, res, projectId);
    case "org":
      return satisfiesDefGate(req, policy.org) ? true : deny(policy.org, "an org-wide definition");
    case "sidecar":
      res.status(400).json({ error: "the definition importer does not support the sidecar target" });
      return false;
  }
}
