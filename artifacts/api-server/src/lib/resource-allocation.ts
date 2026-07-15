/**
 * Resource allocation / booking — the DATA only. The resource views were read-only analytics; this adds the
 * missing WRITE side (Planview/SAP-class): book a named person onto a project for hours over a period.
 * Allocations are stored as JSON in the per-deployment config store; this module owns the shape validator +
 * a raw-ROW emitter. It deliberately holds NO aggregation of its own — every roll-up ("booked hours by
 * resource / by project / by period") is the ONE generic `rollup` over these rows, driven by a JSON def, so
 * the pattern is identical to every other output of the system.
 */

export class ResourceAllocationError extends Error {
  constructor(message: string) { super(message); this.name = "ResourceAllocationError"; }
}

/** A booking: `resource` (a person — id / email / name) committed to `projectId` for `hours` over a period. */
export interface ResourceAllocation {
  id: string;
  resource: string;
  projectId: string;
  hours: number;
  periodStart: string; // ISO date
  periodEnd: string;   // ISO date
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s));

/** Validate + normalise the stored allocation list. Pure — throws {@link ResourceAllocationError}. */
export function validateResourceAllocations(value: unknown): ResourceAllocation[] {
  if (!Array.isArray(value)) throw new ResourceAllocationError("resourceAllocations must be an array");
  const ids = new Set<string>();
  return value.map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const id = str(o["id"]);
    const resource = str(o["resource"]);
    const projectId = str(o["projectId"]);
    if (!id || !resource || !projectId) throw new ResourceAllocationError("each allocation needs id, resource, projectId");
    if (ids.has(id)) throw new ResourceAllocationError(`duplicate allocation id "${id}"`);
    ids.add(id);
    const hours = o["hours"];
    if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 0) throw new ResourceAllocationError(`allocation "${id}" hours must be a non-negative number`);
    const periodStart = str(o["periodStart"]);
    const periodEnd = str(o["periodEnd"]);
    if (!isDay(periodStart) || !isDay(periodEnd)) throw new ResourceAllocationError(`allocation "${id}" needs ISO periodStart/periodEnd dates`);
    if (Date.parse(periodEnd) < Date.parse(periodStart)) throw new ResourceAllocationError(`allocation "${id}" periodEnd is before periodStart`);
    return { id, resource, projectId, hours, periodStart, periodEnd };
  });
}

/** The allocations as GENERIC ROWS — a flat, artifact-agnostic table the generic `rollup` (and any renderer)
 *  groups / plots on the fly. `year` is derived from periodStart so a JSON def can roll up by year with no
 *  extra code. No aggregation here. */
export function allocationRows(allocs: readonly ResourceAllocation[]): Array<Record<string, unknown>> {
  return allocs.map((a) => ({
    resource: a.resource, projectId: a.projectId, hours: a.hours,
    periodStart: a.periodStart, periodEnd: a.periodEnd, year: a.periodStart.slice(0, 4),
  }));
}
