import type { Request, Response } from "express";
import { requireArtifactStore } from "./artifact-store";
import { getDef, putDef, type StoredDef } from "./def-import";
import { contextFromReq } from "../broker";
import type { ConfigScopes } from "./scoped-config";

/**
 * The scope-overridable VOCABULARY plane (energy / impact / likelihood / severity / work / task / RAG) is
 * seven byte-for-byte identical routers: `GET /api/<x>-vocabulary` resolves the effective levels for the
 * caller's scope, `PUT` sets the org-scope override (pmo/admin). This centralises the two moving parts — the
 * read-scope resolver and the Lane-2 write's parse+run — so each file carries only its config-specific
 * symbols and a thin descriptor LITERAL (kept a literal so the API-REFERENCE generator can still read the
 * route's method/path/gate statically). Centralize by mechanism, not by noun (DESIGN-PRINCIPLES §17).
 */

/** Read the request's resolution scopes: programme/project from the query, user from the auth context. */
export function vocabularyScopes(req: Request): ConfigScopes {
  const q = (req as { query?: Record<string, unknown> }).query ?? {};
  const scopes: ConfigScopes = {};
  if (typeof q["programmeId"] === "string" && q["programmeId"]) scopes.programmeId = q["programmeId"];
  if (typeof q["projectId"] === "string" && q["projectId"]) scopes.projectId = q["projectId"];
  const sub = contextFromReq(req).sub;
  if (sub) scopes.sub = sub;
  return scopes;
}

/** Build the `parse` for a vocabulary PUT: the artifact-store guard, then sanitise (→ 400 on throw). */
export function vocabularyParse<V>(sanitize: (body: unknown) => V, invalidMessage: string) {
  return (req: Request, res: Response): { values: V } | null => {
    if (!requireArtifactStore(res)) return null;
    try {
      return { values: sanitize(req.body ?? {}) };
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : invalidMessage });
      return null;
    }
  };
}

/** Build the `run` for a vocabulary PUT: upsert the org-scope def, then resolve the effective vocab. */
export function vocabularyRun<V>(cfg: {
  configId: string;
  orgId: string;
  defName: string;
  resolve: (scopes: ConfigScopes) => unknown;
}) {
  return async (req: Request, _res: Response, { values }: { values: V }): Promise<unknown> => {
    const payload = { id: cfg.configId, values };
    const existing = getDef({ kind: "org" }, cfg.orgId);
    const ctx = contextFromReq(req);
    const now = new Date().toISOString();
    const row: StoredDef = existing
      ? { ...existing, payload, updatedAt: now, rowVersion: (existing.rowVersion ?? 1) + 1 }
      : { id: cfg.orgId, kind: "config", name: cfg.defName, payload, createdBy: ctx.email ?? ctx.name ?? ctx.sub ?? null, createdAt: now, updatedAt: now, rowVersion: 1 };
    putDef({ kind: "org" }, row);
    // Return the newly-resolved vocabulary for this caller's scope so the client can update in place.
    return cfg.resolve(vocabularyScopes(req));
  };
}
