import type { ResourceCapacity } from "@workspace/api-client-react";

/**
 * Capacity roll-up — aggregate per-project resource capacity into programme and portfolio totals, so a
 * programme manager sees utilisation across their projects and a PMO sees the whole portfolio. Pure and
 * derive-only (nothing stored); the component fetches each project's capacity and feeds it here.
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

const STANDALONE = "__standalone__";

/** Coerce a possibly-dirty resource number (string, null, NaN, Infinity) to a finite number, else 0. */
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function blank(key: string, label: string): CapacityRollup {
  return { key, label, projects: 0, allocations: 0, overAllocated: 0, assignedHours: 0, availableHours: 0, utilisation: null };
}

/** Fold one project's resources into an accumulating roll-up row. */
function fold(acc: CapacityRollup, p: ProjectCapacity): void {
  acc.projects += 1;
  for (const r of p.resources) {
    // Resource hours/percentages come from the untrusted read model — coerce so a string/null/NaN
    // can't poison the summed totals (a single NaN would turn the whole roll-up into NaN).
    acc.allocations += 1;
    if (num(r.allocationPercentage) > 100) acc.overAllocated += 1;
    acc.assignedHours += num(r.assignedHours);
    acc.availableHours += num(r.availableHours);
  }
}

/** Finalise utilisation once all projects are folded (kept null when no availability is known). */
function withUtilisation(r: CapacityRollup): CapacityRollup {
  return { ...r, utilisation: r.availableHours > 0 ? Math.round((r.assignedHours / r.availableHours) * 1000) / 10 : null };
}

/** Group projects into programme roll-ups (standalone projects share one "Standalone" group) plus a
 *  portfolio-wide total. Programmes are returned most-utilised first so contention surfaces at the top. */
export function rollupByProgramme(projects: ProjectCapacity[]): { programmes: CapacityRollup[]; portfolio: CapacityRollup } {
  const groups = new Map<string, CapacityRollup>();
  const portfolio = blank("__portfolio__", "Portfolio");
  for (const p of projects) {
    const key = p.programmeId ?? STANDALONE;
    const label = p.programmeId ? (p.programmeName ?? p.programmeId) : "Standalone";
    const row = groups.get(key) ?? blank(key, label);
    fold(row, p);
    groups.set(key, row);
    fold(portfolio, p);
  }
  const programmes = [...groups.values()].map(withUtilisation)
    // key (the programmeId) is unique per group ⇒ deterministic order for equal utilisation.
    .sort((a, b) => (b.utilisation ?? -1) - (a.utilisation ?? -1) || a.key.localeCompare(b.key));
  return { programmes, portfolio: withUtilisation(portfolio) };
}
