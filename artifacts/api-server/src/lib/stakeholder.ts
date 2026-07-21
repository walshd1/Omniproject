/**
 * Stakeholder register — the DATA only. A flat list of stakeholders (name, role, influence, interest,
 * engagement) an org authors; the Stakeholders screen renders it through the generic table/rollup primitives
 * (e.g. an influence/interest grouping). Stored as JSON in the per-deployment config store; this module owns
 * the shape validator + a raw-ROW emitter, the same pattern as budget plans / resource allocations.
 */
export class StakeholderError extends Error {
  constructor(message: string) { super(message); this.name = "StakeholderError"; }
}

const LEVELS = new Set(["low", "medium", "high"]);
const level = (v: unknown): string => {
  const s = (typeof v === "string" ? v.trim() : "").toLowerCase();
  return LEVELS.has(s) ? s : "";
};

/** One stakeholder: `influence`/`interest` are low|medium|high; `engagement` is a free label. */
export interface Stakeholder {
  id: string;
  name: string;
  role: string;
  influence: "low" | "medium" | "high";
  interest: "low" | "medium" | "high";
  engagement?: string;
  projectId?: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Validate + normalise the stored stakeholder list. Pure — throws {@link StakeholderError}. */
export function validateStakeholders(value: unknown): Stakeholder[] {
  if (!Array.isArray(value)) throw new StakeholderError("stakeholders must be an array");
  const ids = new Set<string>();
  return value.map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const id = str(o["id"]);
    const name = str(o["name"]);
    const role = str(o["role"]);
    const influence = level(o["influence"]);
    const interest = level(o["interest"]);
    const engagement = str(o["engagement"]);
    const projectId = str(o["projectId"]);
    if (!id || !name) throw new StakeholderError("each stakeholder needs id, name");
    if (!influence || !interest) throw new StakeholderError(`stakeholder "${id}" influence/interest must be low, medium or high`);
    if (ids.has(id)) throw new StakeholderError(`duplicate stakeholder id "${id}"`);
    ids.add(id);
    return {
      id, name, role, influence: influence as Stakeholder["influence"], interest: interest as Stakeholder["interest"],
      ...(engagement ? { engagement } : {}), ...(projectId ? { projectId } : {}),
    };
  });
}

/** The stakeholders as GENERIC ROWS the generic rollup / table renders. No aggregation here. */
export function stakeholderRows(entries: readonly Stakeholder[]): Array<Record<string, unknown>> {
  return entries.map((s) => ({ name: s.name, role: s.role, influence: s.influence, interest: s.interest, engagement: s.engagement ?? "", ...(s.projectId ? { projectId: s.projectId } : {}) }));
}
