import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { requireArtifactStore } from "../lib/artifact-store";
import { contextFromReq } from "../broker";
import { ensureOrgIdentity, updateOrgIdentity, type OrgIdentityPatch } from "../lib/org-identity";

/**
 * ORG IDENTITY — the org's canonical id + name (see lib/org-identity). This is the FIRST thing the first-run
 * wizard asks for ("name your organisation"), and it is UNGATED: naming the org is not the premium white-label
 * `appName` (branding) — every deployment can name itself, licence or none.
 *
 *  - GET  /api/org-identity — any authed user. The current identity (a pure read; id is `""` until minted).
 *  - PUT  /api/org-identity — admin/PMO. Mint the id if needed + set the name. The id is immutable (a caller
 *    can never change it). Persisted at the TOP of the org-level JSON.
 *
 * A dedicated ungated route (not the default-off generic /api/defs importer), so a deployment can always author
 * its own identity in setup.
 */
const router = Router();

router.get("/org-identity", (req, res) => {
  // The org must always HAVE an identity. Boot mints it (see app bootstrap), but mint lazily here too so the id
  // exists the first time anyone reads it, even on a deployment that skipped the boot seed. Idempotent — an
  // already-minted id is never rewritten; a no-op when the store is disabled (nothing can be persisted anyway).
  const identity = ensureOrgIdentity(contextFromReq(req), new Date().toISOString());
  res.json({ identity });
});

router.put("/org-identity", requireAnyRole("pmo", "admin"), (req, res) => {
  if (!requireArtifactStore(res)) return;
  const body = (req.body ?? {}) as { name?: unknown; logo?: unknown; showLogo?: unknown };
  const ctx = contextFromReq(req);
  const now = new Date().toISOString();
  // Build a patch from ONLY the keys the caller supplied (name / logo / showLogo — all ungated); an empty PUT
  // just ensures the id exists (mints it on first touch). The id is never patchable (immutable).
  const patch: OrgIdentityPatch = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.logo !== undefined) patch.logo = body.logo;
  if (body.showLogo !== undefined) patch.showLogo = body.showLogo;
  try {
    const identity = Object.keys(patch).length ? updateOrgIdentity(patch, ctx, now) : ensureOrgIdentity(ctx, now);
    res.json({ identity });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "invalid org identity" });
  }
});

export default router;
