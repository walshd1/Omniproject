import type { Request } from "express";
import { contextFromReq } from "../broker";
import { listDefs, type StoredDef } from "./def-import";
import type { FormDef } from "./form-def";

/**
 * The submittable form-DEFINITIONS read model (roadmap X.10 — forms convergence). Form defs are ARTIFACTS that
 * live in the encrypted def store, authored through the ONE importer; the engine (renderer + the submission
 * route) reads them here. Precedence, lowest → highest:
 *   org  <  project  <  user
 * so a customer copy overrides an older one of the same form id. The shipped system catalogue is deliberately
 * NOT included: those are copy-from TEMPLATES for the authoring UI, not directly-submittable org forms (parity
 * with the pre-convergence behaviour, where only org-authored forms were live).
 */
export function resolveFormDefs(req: Request, opts: { projectId?: string } = {}): FormDef[] {
  const ctx = contextFromReq(req);
  const byId = new Map<string, FormDef>();
  const add = (forms: readonly FormDef[]): void => {
    for (const f of forms) if (f && typeof f.id === "string") byId.set(f.id, f);
  };
  const fromDefs = (rows: StoredDef[]): FormDef[] => rows
    .filter((r) => r.kind === "form" && r.payload && typeof r.payload === "object" && typeof (r.payload as { id?: unknown }).id === "string")
    .map((r) => r.payload as FormDef);

  add(fromDefs(listDefs({ kind: "org" })));
  if (opts.projectId) add(fromDefs(listDefs({ kind: "project", projectId: opts.projectId })));
  if (ctx.sub) add(fromDefs(listDefs({ kind: "user", sub: ctx.sub })));
  return [...byId.values()];
}

/** Resolve ONE submittable form by its (payload) id for the caller's scope, or undefined. */
export function findFormDef(req: Request, formId: string, opts: { projectId?: string } = {}): FormDef | undefined {
  return resolveFormDefs(req, opts).find((f) => f.id === formId);
}
