import type { Request } from "express";
import { contextFromReq } from "../broker";
import { getSettings } from "./settings";
import { listDefs, type StoredDef } from "./def-import";

/** A stored screen definition's payload — an object carrying at least its own screen `id`. */
export type ScreenDefPayload = { id: string } & Record<string, unknown>;

/**
 * The org-authored SCREEN OVERRIDES read model (roadmap X.10 — screens convergence). Screen defs are ARTIFACTS
 * in the encrypted def store now; the SPA merges these over its built-in catalogue (an override wins by id, or
 * adds a net-new screen). The ENGINE (ScreenRenderer + panels) stays code. Precedence, lowest → highest:
 *   legacy settings.screenDefs bridge  <  org  <  project  <  user
 * so a migrated / customer copy overrides an older one of the same id. The legacy settings layer is a migration
 * BRIDGE — once drained to `[]`, screen overrides live purely in the def store. The shipped `system` catalogue
 * is deliberately EXCLUDED here: the SPA already carries the built-ins (the same relocated catalogue), so this
 * endpoint returns only the customer OVERRIDES to merge on top.
 */
export function resolveScreenDefs(req: Request, opts: { projectId?: string } = {}): ScreenDefPayload[] {
  const ctx = contextFromReq(req);
  const byId = new Map<string, ScreenDefPayload>();
  const add = (defs: readonly ScreenDefPayload[]): void => {
    for (const d of defs) if (d && typeof d.id === "string") byId.set(d.id, d);
  };
  const fromDefs = (rows: StoredDef[]): ScreenDefPayload[] => rows
    .filter((r) => r.kind === "screen" && r.payload && typeof r.payload === "object" && typeof (r.payload as { id?: unknown }).id === "string")
    .map((r) => r.payload as ScreenDefPayload);

  const legacy = getSettings().screenDefs;
  if (Array.isArray(legacy)) add(legacy as ScreenDefPayload[]);      // migration bridge (lowest)
  add(fromDefs(listDefs({ kind: "org" })));
  if (opts.projectId) add(fromDefs(listDefs({ kind: "project", projectId: opts.projectId })));
  if (ctx.sub) add(fromDefs(listDefs({ kind: "user", sub: ctx.sub })));
  return [...byId.values()];
}
