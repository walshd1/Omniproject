import type { ResourceCapacity } from "@workspace/api-client-react";
import { consolidateByGroup, consolidationSpec, type ConsolidatedRow } from "@workspace/backend-catalogue";

/**
 * Capacity roll-up — aggregate per-project resource capacity into programme and portfolio totals, so a
 * programme manager sees utilisation across their projects and a PMO sees the whole portfolio. The
 * group → count/sum → derive → sort fold is the generic `consolidateByGroup` engine driven by the
 * `capacity` JSON spec (no currency dimension — every row shares one nominal currency so FX is inert);
 * this module only maps a project to its programme group and re-labels the generic row. Pure, derive-only.
 */

/** One project's capacity, tagged with its programme for grouping. */
export interface ProjectCapacity {
  projectId: string;
  projectName: string;
  programmeId: string | null;
  programmeName: string | null;
  resources: ResourceCapacity[];
}

/** An aggregated capacity row (a programme, or the whole portfolio). */
export interface CapacityRollup {
  key: string;
  label: string;
  projects: number;
  /** Resource allocations summed across the group's projects (a person on two projects counts twice). */
  allocations: number;
  /** Allocations over 100% — the contention signal. */
  overAllocated: number;
  assignedHours: number;
  availableHours: number;
  /** assigned / available × 100, or null when there's no declared availability. */
  utilisation: number | null;
}

/** The synthetic group key for projects with no programme. Exported so callers building on top of
 *  the roll-up (e.g. resource-levelling's move simulation) can look up a programme's row by the same
 *  key `rollupByProgramme` uses, instead of re-deriving the "standalone" sentinel themselves. */
export const STANDALONE_PROGRAMME_KEY = "__standalone__";
const STANDALONE = STANDALONE_PROGRAMME_KEY;
const CAPACITY_SPEC = consolidationSpec("capacity");

/** Re-label a generic consolidated row as a capacity roll-up (the spec's metric keys map 1:1). */
function toCapacityRollup(r: ConsolidatedRow): CapacityRollup {
  const m = r.metrics;
  return {
    key: r.key,
    label: r.label,
    projects: r.projects,
    allocations: (m["allocations"] as number) ?? 0,
    overAllocated: (m["overAllocated"] as number) ?? 0,
    assignedHours: (m["assignedHours"] as number) ?? 0,
    availableHours: (m["availableHours"] as number) ?? 0,
    utilisation: (m["utilisation"] as number | null) ?? null,
  };
}

/** Group projects into programme roll-ups (standalone projects share one "Standalone" group) plus a
 *  portfolio-wide total. Programmes are returned most-utilised first so contention surfaces at the top. */
export function rollupByProgramme(projects: ProjectCapacity[]): { programmes: CapacityRollup[]; portfolio: CapacityRollup } {
  // One nominal currency for every group so the money engine's FX pass is a no-op (capacity has none).
  const inputs = projects.map((p) => ({
    groupKey: p.programmeId ?? STANDALONE,
    groupLabel: p.programmeId ? (p.programmeName ?? p.programmeId) : "Standalone",
    currency: "•",
    items: p.resources as unknown as Record<string, unknown>[],
  }));
  const { groups, total } = consolidateByGroup(inputs, CAPACITY_SPEC, "•");
  return { programmes: groups.map(toCapacityRollup), portfolio: toCapacityRollup(total) };
}
