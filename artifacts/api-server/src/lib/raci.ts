/**
 * RACI register — the DATA only. A flat list of (task, role, responsibility) assignments an org authors; the
 * RACI matrix screen renders it through the generic table/rollup primitives (group by task or role). Stored
 * as JSON in the per-deployment config store; this module owns the shape validator + a raw-ROW emitter, the
 * same pattern as budget plans / resource allocations. No aggregation here.
 */
export class RaciError extends Error {
  constructor(message: string) { super(message); this.name = "RaciError"; }
}

/** Responsibility per RACI: Responsible / Accountable / Consulted / Informed. */
export type RaciResponsibility = "R" | "A" | "C" | "I";
const RESP = new Set(["R", "A", "C", "I"]);

/** One RACI assignment: a `role` (person / team) carries a `responsibility` for a `task`. */
export interface RaciEntry {
  id: string;
  task: string;
  role: string;
  responsibility: RaciResponsibility;
  projectId?: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Validate + normalise the stored RACI list. Pure — throws {@link RaciError}. */
export function validateRaci(value: unknown): RaciEntry[] {
  if (!Array.isArray(value)) throw new RaciError("raci must be an array");
  const ids = new Set<string>();
  return value.map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const id = str(o["id"]);
    const task = str(o["task"]);
    const role = str(o["role"]);
    const responsibility = str(o["responsibility"]).toUpperCase();
    const projectId = str(o["projectId"]);
    if (!id || !task || !role) throw new RaciError("each RACI entry needs id, task, role");
    if (!RESP.has(responsibility)) throw new RaciError(`RACI entry "${id}" responsibility must be one of R, A, C, I`);
    if (ids.has(id)) throw new RaciError(`duplicate RACI entry id "${id}"`);
    ids.add(id);
    return { id, task, role, responsibility: responsibility as RaciResponsibility, ...(projectId ? { projectId } : {}) };
  });
}

/** The RACI entries as GENERIC ROWS the generic rollup / table renders. No aggregation here. */
export function raciRows(entries: readonly RaciEntry[]): Array<Record<string, unknown>> {
  return entries.map((e) => ({ task: e.task, role: e.role, responsibility: e.responsibility, ...(e.projectId ? { projectId: e.projectId } : {}) }));
}
