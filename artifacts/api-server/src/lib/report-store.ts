import type { Request } from "express";
import { contextFromReq } from "../broker";
import { getSettings } from "./settings";
import { listDefs, type StoredDef } from "./def-import";

/** A stored custom-report definition's payload — an object carrying at least its own report `id`. */
export type CustomReportPayload = { id: string } & Record<string, unknown>;

/**
 * The bespoke-report DEFINITIONS read model (roadmap X.10 — reports convergence). Custom report defs are
 * ARTIFACTS in the encrypted def store now, authored through the ONE importer; the ENGINE (the CustomReport
 * renderer) reads them here instead of the legacy `settings.customReports` slice. Precedence, lowest → highest:
 *   legacy settings bridge  <  org  <  project  <  user
 * so a migrated / customer copy overrides an older one of the same id. The legacy settings layer is a migration
 * BRIDGE — once drained to `[]`, report defs live purely in the def store. (Overrides of the SHIPPED built-in
 * reports stay in the separate `reportOverrides` settings overlay — metadata tweaks, not standalone defs.)
 */
export function resolveCustomReports(req: Request, opts: { projectId?: string } = {}): CustomReportPayload[] {
  const ctx = contextFromReq(req);
  const byId = new Map<string, CustomReportPayload>();
  const add = (defs: readonly CustomReportPayload[]): void => {
    for (const d of defs) if (d && typeof d.id === "string") byId.set(d.id, d);
  };
  const fromDefs = (rows: StoredDef[]): CustomReportPayload[] => rows
    .filter((r) => r.kind === "report" && r.payload && typeof r.payload === "object" && typeof (r.payload as { id?: unknown }).id === "string")
    .map((r) => r.payload as CustomReportPayload);

  const legacy = getSettings().customReports;
  if (Array.isArray(legacy)) add(legacy as unknown as CustomReportPayload[]);   // migration bridge (lowest)
  add(fromDefs(listDefs({ kind: "org" })));
  if (opts.projectId) add(fromDefs(listDefs({ kind: "project", projectId: opts.projectId })));
  if (ctx.sub) add(fromDefs(listDefs({ kind: "user", sub: ctx.sub })));
  return [...byId.values()];
}
