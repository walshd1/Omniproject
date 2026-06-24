import type { Row } from "./data";

/**
 * Programmes are a grouping of related projects, **derived** from each project's
 * optional `programmeId` (owned by the backend). OmniProject stores nothing — it
 * groups and rolls up. Consequences of deriving from membership:
 *   - a programme exists only when ≥ 1 project references it (the invariant);
 *   - projects without a programmeId are standalone (not in any programme).
 * Pure functions so they're unit-tested.
 */

export interface ProgrammeRollup {
  id: string;
  name: string;
  projectCount: number;
  issueCount: number;
  completedCount: number;
  completionRate: number;
  ragStatus: "GREEN" | "AMBER" | "RED";
  updatedAt: string | null;
}

export interface ProgrammeDetail extends ProgrammeRollup {
  projects: Row[];
}

function ragFor(completionRate: number): "GREEN" | "AMBER" | "RED" {
  if (completionRate >= 60) return "GREEN";
  if (completionRate >= 25) return "AMBER";
  return "RED";
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function summarise(id: string, projects: Row[]): ProgrammeRollup {
  let issueCount = 0;
  let completedCount = 0;
  let name = id;
  let updatedAt: string | null = null;
  for (const p of projects) {
    issueCount += num(p["issueCount"]);
    completedCount += num(p["completedCount"]);
    const pn = p["programmeName"];
    if (typeof pn === "string" && pn) name = pn;
    const u = p["updatedAt"];
    if (typeof u === "string" && (!updatedAt || u > updatedAt)) updatedAt = u;
  }
  const completionRate = issueCount > 0 ? Math.round((completedCount / issueCount) * 100) : 0;
  return { id, name, projectCount: projects.length, issueCount, completedCount, completionRate, ragStatus: ragFor(completionRate), updatedAt };
}

function programmeIdOf(p: Row): string | null {
  const v = p["programmeId"];
  return typeof v === "string" && v ? v : null;
}

/** Group projects into programmes (standalone projects are excluded). */
export function groupProgrammes(projects: Row[]): ProgrammeRollup[] {
  const groups = new Map<string, Row[]>();
  for (const p of projects) {
    const id = programmeIdOf(p);
    if (!id) continue;
    const list = groups.get(id) ?? [];
    list.push(p);
    groups.set(id, list);
  }
  return [...groups.entries()].map(([id, ps]) => summarise(id, ps)).sort((a, b) => a.name.localeCompare(b.name));
}

/** A programme's roll-up + its member projects, or null if it has none. */
export function programmeDetail(projects: Row[], id: string): ProgrammeDetail | null {
  const members = projects.filter((p) => programmeIdOf(p) === id);
  if (members.length === 0) return null;
  return { ...summarise(id, members), projects: members };
}

/** Count of projects not in any programme (for the UI's "standalone" section). */
export function standaloneCount(projects: Row[]): number {
  return projects.filter((p) => !programmeIdOf(p)).length;
}
