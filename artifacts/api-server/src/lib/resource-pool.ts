import type { ProjectMember, ResourceMember } from "../broker/types";

/**
 * Aggregate per-project member rosters into one portfolio-wide resource pool:
 * dedupe people by id, union their skills, sum their capacity, and collect the
 * projects they belong to. Pure so the maths is unit-testable. Capacity sums are
 * null only when NO project supplied a number (so "0" and "unknown" stay
 * distinct).
 */
export function aggregateResourcePool(rosters: Array<{ projectId: string; members: ProjectMember[] }>): ResourceMember[] {
  const byId = new Map<string, ResourceMember>();

  for (const { projectId, members } of rosters) {
    for (const m of members) {
      let agg = byId.get(m.id);
      if (!agg) {
        agg = { id: m.id, name: m.name ?? null, email: m.email ?? null, skills: [], availableHours: null, allocatedHours: null, projectIds: [] };
        byId.set(m.id, agg);
      }
      agg.name ??= m.name ?? null;
      agg.email ??= m.email ?? null;
      if (!agg.projectIds.includes(projectId)) agg.projectIds.push(projectId);
      for (const s of m.skills ?? []) if (!agg.skills.includes(s)) agg.skills.push(s);
      if (typeof m.availableHours === "number") agg.availableHours = (agg.availableHours ?? 0) + m.availableHours;
      if (typeof m.allocatedHours === "number") agg.allocatedHours = (agg.allocatedHours ?? 0) + m.allocatedHours;
    }
  }

  return [...byId.values()].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
}
