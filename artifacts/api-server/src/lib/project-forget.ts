import { getSettings, updateSettings } from "./settings";
import type { ClosedProjectRecord } from "./closed-projects";

/**
 * "Delete a project" in OmniProject = FORGET its correlation GUID from every list that references it,
 * and RETIRE the GUID. OmniProject holds no project data (it lives in the backend SOR, or the
 * self-managed archive), so a delete only unlinks references — the closed-project index entry, its
 * membership in any programme, and any GUID alias that points to or from it. The actual data is never
 * touched. It also tombstones the GUID (`retiredGuids`) so the project can NEVER silently reactivate:
 * even if a backend re-serves it, retired GUIDs are suppressed from live reads. Bringing it back is a
 * deliberate re-link to a NEW GUID. Admin/PMO only.
 */

export interface ForgetResult {
  guid: string;
  /** Was there a closed-project index entry for this GUID? */
  removedFromClosed: boolean;
  /** Programme ids the GUID was a member of (now removed). */
  removedFromProgrammes: string[];
  /** How many GUID aliases referencing this GUID (either side) were dropped. */
  removedAliases: number;
  /** The GUID is now retired (tombstoned) — it can't silently reactivate. */
  retired: boolean;
}

/** Everything OmniProject references about a project GUID — the exportable record an admin can save
 *  before deleting (so nothing is lost silently). */
export interface ProjectReferences {
  guid: string;
  closed: ClosedProjectRecord | null;
  /** Programme ids this GUID is a member of. */
  programmes: string[];
  /** Old GUIDs that relink TO this one. */
  aliasedFrom: string[];
  /** Where this GUID relinks to, if anywhere. */
  aliasTo: string | null;
  retired: boolean;
}

/** Gather (without mutating) everything OmniProject holds about a project GUID — for export before a
 *  delete. */
export function collectProjectReferences(guid: string): ProjectReferences {
  const g = guid.trim();
  const s = getSettings();
  return {
    guid: g,
    closed: s.closedProjects[g] ?? null,
    programmes: Object.entries(s.programmeRegistry).filter(([, d]) => d.instanceIds.includes(g)).map(([id]) => id),
    aliasedFrom: Object.entries(s.guidAliases).filter(([, to]) => to === g).map(([from]) => from),
    aliasTo: s.guidAliases[g] ?? null,
    retired: s.retiredGuids.includes(g),
  };
}

/** Compute + apply the removal of `guid` from all OmniProject reference lists AND retire it, atomically
 *  via `updateSettings`. Returns what was unlinked. */
export function forgetProjectGuid(guid: string): ForgetResult {
  const g = guid.trim();
  const s = getSettings();

  const closed = { ...s.closedProjects };
  const removedFromClosed = g in closed;
  delete closed[g];

  const programmeRegistry: typeof s.programmeRegistry = {};
  const removedFromProgrammes: string[] = [];
  for (const [id, def] of Object.entries(s.programmeRegistry)) {
    if (def.instanceIds.includes(g)) {
      removedFromProgrammes.push(id);
      programmeRegistry[id] = { ...def, instanceIds: def.instanceIds.filter((x) => x !== g) };
    } else {
      programmeRegistry[id] = def;
    }
  }

  const guidAliases: typeof s.guidAliases = {};
  let removedAliases = 0;
  for (const [oldG, newG] of Object.entries(s.guidAliases)) {
    if (oldG === g || newG === g) removedAliases++;
    else guidAliases[oldG] = newG;
  }

  // Tombstone the GUID so it can't silently reactivate (idempotent).
  const retiredGuids = g ? [...new Set([...s.retiredGuids, g])] : s.retiredGuids;

  updateSettings({ closedProjects: closed, programmeRegistry, guidAliases, retiredGuids });
  return { guid: g, removedFromClosed, removedFromProgrammes, removedAliases, retired: !!g };
}
