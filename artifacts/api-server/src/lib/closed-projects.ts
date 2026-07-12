/**
 * CLOSED-PROJECT LOCATION REGISTRY — the small, durable index that lets OmniProject keep serving closed
 * projects' data without pulling every project that ever existed through the live broker forever.
 *
 * The live broker only ever pulls the LIVE working set (see lib/data `liveProjectsOnly`). When a project
 * closes, an admin/PMO records here — keyed by its correlation GUID (`omniInstanceId`) — WHERE its data
 * now lives:
 *   · `sor`     — left in the current System Of Record (the backend still holds it); retrieve on demand.
 *   · `archive` — migrated out to a self-managed archive (the Postgres arch); retrieve from there.
 * So OmniProject stores a tiny location index, not the bulk data. Every report/rollup carries the source
 * GUIDs it spans and resolves each against the live set + this registry (see `planProjectSources`),
 * pulling from wherever that GUID's data actually rests. Sealed at rest with the rest of settings.
 */

export const PROJECT_DISPOSITIONS = ["sor", "archive"] as const;
export type ProjectDisposition = (typeof PROJECT_DISPOSITIONS)[number];

/** Where a closed project's data lives, and where it closed. */
export interface ClosedProjectRecord {
  /** `sor` = still in the originating backend; `archive` = migrated to the self-managed archive. */
  disposition: ProjectDisposition;
  /** The backend/source the project closed in (needed to retrieve it when disposition is `sor`). */
  source?: string;
  /** When it was closed/recorded (ISO 8601), for audit + retention policy. */
  closedAt?: string;
  /** Free-text note (e.g. the archive location or a decommission ticket). */
  note?: string;
}

/** GUID (`omniInstanceId`) → where its data lives. */
export type ClosedProjectRegistry = Record<string, ClosedProjectRecord>;

export class ClosedProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClosedProjectError";
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Validate + normalise the closed-project registry (trims, defaults, checks disposition). */
export function validateClosedProjects(value: unknown): ClosedProjectRegistry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ClosedProjectError("closedProjects must be an object of projectGuid → { disposition, … }");
  }
  const out: ClosedProjectRegistry = {};
  for (const [rawGuid, rec] of Object.entries(value)) {
    const guid = str(rawGuid);
    if (!guid) throw new ClosedProjectError("project GUID must be non-empty");
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) throw new ClosedProjectError(`closed project "${guid}" must be an object`);
    const r = rec as Record<string, unknown>;
    const disposition = str(r["disposition"]) as ProjectDisposition;
    if (!(PROJECT_DISPOSITIONS as readonly string[]).includes(disposition)) {
      throw new ClosedProjectError(`closed project "${guid}" needs a disposition of ${PROJECT_DISPOSITIONS.join(" or ")}`);
    }
    const record: ClosedProjectRecord = { disposition };
    const source = str(r["source"]);
    if (source) record.source = source;
    const closedAt = str(r["closedAt"]);
    if (closedAt) record.closedAt = closedAt;
    const note = str(r["note"]);
    if (note) record.note = note;
    out[guid] = record;
  }
  return out;
}

/** Where each source GUID's data must be pulled from — the primitive every report/rollup uses to fan a
 *  set of project GUIDs across the live broker, the originating SOR, and the self-managed archive. A GUID
 *  not in the registry is LIVE (the default); a registered one is `sor` or `archive` per its disposition. */
export interface SourcePlan {
  /** Pull from the live broker (active projects). */
  live: string[];
  /** Pull from the originating backend on demand (closed, left in place). */
  sor: string[];
  /** Pull from the self-managed archive (closed, migrated). */
  archive: string[];
}

export function planProjectSources(guids: Iterable<string>, registry: ClosedProjectRegistry): SourcePlan {
  const plan: SourcePlan = { live: [], sor: [], archive: [] };
  const seen = new Set<string>();
  for (const raw of guids) {
    const guid = str(raw);
    if (!guid || seen.has(guid)) continue;
    seen.add(guid);
    const rec = registry[guid];
    if (!rec) plan.live.push(guid);
    else if (rec.disposition === "archive") plan.archive.push(guid);
    else plan.sor.push(guid);
  }
  return plan;
}
