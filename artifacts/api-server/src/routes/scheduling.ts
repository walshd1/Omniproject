import { Router } from "express";
import { getSession } from "./auth";
import { requireAnyRole } from "../lib/rbac";
import { artifactStoreEnabled, makeScopedId } from "../lib/artifact-store";
import { getDef, putDef, newStoredDef, validateDef, checkImportIntegrity, type StoredDef } from "../lib/def-import";
import { contextFromReq } from "../broker";
import {
  resolveScheduling, sanitizeSchedulingValues, SCHEDULING_CONFIG_ID, DEFAULT_SCHEDULING, type ConfigScopes,
} from "../lib/scoped-config";

/**
 * The working-time policy for the (client-side, projected) scheduling engine, held in the composition model
 * as a scope-layered `scheduling` config def (NOT a settings key — see lib/scoped-config).
 *
 *  - GET /api/scheduling/resolved?programmeId=&projectId= — the effective policy folded across scopes
 *    (system < org < programme < project < user), for the client scheduler which computes the actual schedule
 *    live and never persists it. Any authed user.
 *  - GET /api/scheduling — the ORG-scope config values (what the admin editor seeds from). Admin/PMO.
 *  - PUT /api/scheduling — write the ORG-scope `scheduling` config def (validated working-time values).
 *    Admin/PMO. This is a dedicated ungated route (the generic /api/defs importer is behind a default-off
 *    module), so a deployment can always author its working-time policy.
 *
 * The org's config def is a singleton with a STABLE storage id, so PUT updates it in place.
 */
const router = Router();

/** The stable storage id of the org-scope `scheduling` config def (singleton — one working-time policy/org). */
const ORG_SCHEDULING_ID = makeScopedId("org", `config-${SCHEDULING_CONFIG_ID}`);

/** The org-scope scheduling config def's current values (defaults when unset / no store). */
function orgSchedulingValues(): Record<string, unknown> {
  if (!artifactStoreEnabled()) return {};
  const row = getDef({ kind: "org" }, ORG_SCHEDULING_ID);
  const v = (row?.payload as { values?: unknown } | undefined)?.values;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

router.get("/scheduling/resolved", (req, res) => {
  const q = req.query as Record<string, unknown>;
  const scopes: ConfigScopes = {};
  if (typeof q["programmeId"] === "string" && q["programmeId"]) scopes.programmeId = q["programmeId"];
  if (typeof q["projectId"] === "string" && q["projectId"]) scopes.projectId = q["projectId"];
  const s = getSession(req);
  if (s) scopes.sub = s.sub;
  res.json({ scheduling: resolveScheduling(scopes) });
});

router.get("/scheduling", requireAnyRole("pmo", "admin"), (_req, res) => {
  res.json({ scheduling: { ...DEFAULT_SCHEDULING, ...orgSchedulingValues() } });
});

router.put("/scheduling", requireAnyRole("pmo", "admin"), (req, res) => {
  if (!artifactStoreEnabled()) { res.status(501).json({ error: "no encrypted-JSON store is configured on this deployment" }); return; }
  const body = (req.body ?? {}) as { scheduling?: unknown };
  const raw = body.scheduling ?? req.body;
  let values: Record<string, unknown>;
  try { values = sanitizeSchedulingValues(raw) as Record<string, unknown>; }
  catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "invalid scheduling values" }); return; }

  const payload = { id: SCHEDULING_CONFIG_ID, values };
  // Pass through the SAME validated write path the importer uses: kind validator + bidirectional integrity.
  const check = validateDef("config", payload);
  if (!check.ok) { res.status(400).json({ error: check.errors.join("; ") }); return; }
  const existing = getDef({ kind: "org" }, ORG_SCHEDULING_ID);
  const integrityErr = checkImportIntegrity("config", payload, existing ? { storageId: ORG_SCHEDULING_ID, priorId: SCHEDULING_CONFIG_ID } : undefined);
  if (integrityErr) { res.status(400).json({ error: integrityErr }); return; }

  const ctx = contextFromReq(req);
  const now = new Date().toISOString();
  const row: StoredDef = existing
    ? { ...existing, payload, updatedAt: now, rowVersion: (existing.rowVersion ?? 1) + 1 }
    : newStoredDef(ORG_SCHEDULING_ID, { kind: "config", name: "Working time", payload, value: payload }, ctx, now);
  putDef({ kind: "org" }, row);
  res.json({ scheduling: { ...DEFAULT_SCHEDULING, ...values } });
});

export default router;
