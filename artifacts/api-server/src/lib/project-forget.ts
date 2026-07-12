import { getSettings, updateSettings } from "./settings";

/**
 * "Delete a project" in OmniProject = FORGET its correlation GUID from every list that references it.
 * OmniProject holds no project data (it lives in the backend SOR, or the self-managed archive), so a
 * delete only unlinks references — the closed-project index entry, its membership in any programme, and
 * any GUID alias that points to or from it. The actual data is never touched. Admin/PMO only.
 */

export interface ForgetResult {
  guid: string;
  /** Was there a closed-project index entry for this GUID? */
  removedFromClosed: boolean;
  /** Programme ids the GUID was a member of (now removed). */
  removedFromProgrammes: string[];
  /** How many GUID aliases referencing this GUID (either side) were dropped. */
  removedAliases: number;
}

/** Compute + apply the removal of `guid` from all OmniProject reference lists, atomically via
 *  `updateSettings`. Returns what was unlinked (all-false/empty when the GUID wasn't referenced). */
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

  updateSettings({ closedProjects: closed, programmeRegistry, guidAliases });
  return { guid: g, removedFromClosed, removedFromProgrammes, removedAliases };
}
