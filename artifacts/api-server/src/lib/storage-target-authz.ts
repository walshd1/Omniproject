import type { Request, Response } from "express";
import type { StorageTarget } from "./artifact-store";
import { hasRole } from "./rbac";
import { guardProjectScope } from "./project-scope";

/**
 * SHARED per-target authorization for a storage-target artifact operation (whiteboards, wiki pages, …). The
 * RBAC floor (viewer read / contributor write) is applied by the route middleware; this adds the
 * target-specific rule on top so every artifact kind gates a target the SAME way (no drift):
 *   - `user`     the caller's own private area — always allowed (the scope uses the caller's own sub, so it
 *                is structurally isolated; one caller's id can never address another's area).
 *   - `project`  gated by the caller's project scope (`guardProjectScope`); a missing projectId is a 400.
 *   - `org`      reads open to any viewer+; writes/deletes need manager+.
 *   - `sidecar`  requires the active broker to model this artifact (else 501).
 *
 * Returns true when allowed; otherwise it has ALREADY sent the response (403/400/501) and the caller must
 * return. `op` is "read" for GET and "write" for POST/PUT/DELETE (a delete is a write for gating purposes).
 */
export async function authorizeStorageTarget(
  req: Request, res: Response, storage: StorageTarget, projectId: string | undefined,
  op: "read" | "write", opts: { capability: boolean; capabilityError: string },
): Promise<boolean> {
  switch (storage) {
    case "user":
      return true;
    case "project":
      if (!projectId) { res.status(400).json({ error: "a project artifact needs a projectId" }); return false; }
      return guardProjectScope(req, res, projectId);
    case "org":
      if (op === "write" && !hasRole(req, "manager")) {
        res.status(403).json({ error: "org-wide artifacts require at least the manager role" });
        return false;
      }
      return true;
    case "sidecar":
      if (!opts.capability) { res.status(501).json({ error: opts.capabilityError }); return false; }
      return true;
  }
}
