import { Router } from "express";
import { getSession } from "./auth";
import { requireAnyRole } from "../lib/rbac";
import { artifactStoreEnabled, makeScopedId, requireArtifactStore } from "../lib/artifact-store";
import { getDef, putDef, newStoredDef, validateDef, checkImportIntegrity, type StoredDef } from "../lib/def-import";
import { contextFromReq } from "../broker";
import {
  resolveAccounting, sanitizeAccountingValues, missingAccountingAccounts,
  ACCOUNTING_CONFIG_ID, DEFAULT_ACCOUNTING, type ConfigScopes,
} from "../lib/scoped-config";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";

/**
 * The ORG ACCOUNTING POLICY — chart-of-accounts codes + depreciation policy — held in the composition model as a
 * scope-layered `accounting` config def (NOT a settings key — see lib/scoped-config), exactly like `scheduling`.
 * This is how an org's finance variables live in org JSON instead of being baked into the engine.
 *
 *  - GET /api/accounting/resolved?programmeId=&projectId= — the effective policy folded across scopes
 *    (system < org < programme < project < user). Includes `missingAccounts`, the GL codes still unset (a
 *    depreciation/disposal posting can't run until they are). Any authed user.
 *  - GET /api/accounting — the ORG-scope config values (what the admin editor seeds from). Admin/PMO.
 *  - PUT /api/accounting — write the ORG-scope `accounting` config def (validated codes + policy). Admin/PMO.
 *
 * The org's config def is a singleton with a STABLE storage id, so PUT updates it in place.
 */
const router = Router();

/** The stable storage id of the org-scope `accounting` config def (singleton — one accounting policy/org). */
const ORG_ACCOUNTING_ID = makeScopedId("org", `config-${ACCOUNTING_CONFIG_ID}`);

/** The org-scope accounting config def's current values (defaults when unset / no store). */
function orgAccountingValues(): Record<string, unknown> {
  if (!artifactStoreEnabled()) return {};
  const row = getDef({ kind: "org" }, ORG_ACCOUNTING_ID);
  const v = (row?.payload as { values?: unknown } | undefined)?.values;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

router.get("/accounting/resolved", (req, res) => {
  const q = req.query as Record<string, unknown>;
  const scopes: ConfigScopes = {};
  if (typeof q["programmeId"] === "string" && q["programmeId"]) scopes.programmeId = q["programmeId"];
  if (typeof q["projectId"] === "string" && q["projectId"]) scopes.projectId = q["projectId"];
  const s = getSession(req);
  if (s) scopes.sub = s.sub;
  const accounting = resolveAccounting(scopes);
  res.json({ accounting, missingAccounts: missingAccountingAccounts(accounting) });
});

router.get("/accounting", requireAnyRole("pmo", "admin"), (_req, res) => {
  res.json({ accounting: { ...DEFAULT_ACCOUNTING, ...orgAccountingValues() } });
});

/**
 * PUT /api/accounting — write the org-scope accounting config def (admin/PMO), validated.
 *
 * LANE 2: writing the org accounting policy is a config governance verb — the PMO-or-admin union rides in
 * `gates`; the sealed-store precondition and the full validation chain (sanitise → kind validator →
 * bidirectional integrity) are the parse gate, each returning null having already sent its 4xx (503 store-off,
 * 400 invalid). Parse hands `run` the validated payload + the resolved `existing` row, so the write is a pure
 * effect that records a success audit (accounting.save).
 */
export const accountingSaveCommand: CommandDescriptor<{
  values: Record<string, unknown>;
  payload: { id: string; values: Record<string, unknown> };
  existing: StoredDef | null;
}> = {
  name: "accounting.save",
  method: "put",
  path: "/accounting",
  gates: [requireAnyRole("pmo", "admin")],
  parse: (req, res) => {
    if (!requireArtifactStore(res)) return null;
    const body = (req.body ?? {}) as { accounting?: unknown };
    const raw = body.accounting ?? req.body;
    let values: Record<string, unknown>;
    try { values = sanitizeAccountingValues(raw) as Record<string, unknown>; }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "invalid accounting values" }); return null; }

    const payload = { id: ACCOUNTING_CONFIG_ID, values };
    const check = validateDef("config", payload);
    if (!check.ok) { res.status(400).json({ error: check.errors.join("; ") }); return null; }
    const existing = getDef({ kind: "org" }, ORG_ACCOUNTING_ID);
    const integrityErr = checkImportIntegrity("config", payload, existing ? { storageId: ORG_ACCOUNTING_ID, priorId: ACCOUNTING_CONFIG_ID } : undefined);
    if (integrityErr) { res.status(400).json({ error: integrityErr }); return null; }
    return { values, payload, existing };
  },
  run: async (req, _res, { payload, existing }) => {
    const ctx = contextFromReq(req);
    const now = new Date().toISOString();
    const row: StoredDef = existing
      ? { ...existing, payload, updatedAt: now, rowVersion: (existing.rowVersion ?? 1) + 1 }
      : newStoredDef(ORG_ACCOUNTING_ID, { kind: "config", name: "Accounting policy", payload, value: payload }, ctx, now);
    putDef({ kind: "org" }, row);
    return { accounting: resolveAccounting({}) };
  },
  audit: "accounting.save",
  auditCategory: "admin",
};
mountCommand(router, accountingSaveCommand);

export default router;
