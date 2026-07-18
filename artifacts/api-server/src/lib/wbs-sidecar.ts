import { getArtifact, putArtifact, artifactStoreEnabled, type ArtifactScope } from "./artifact-store";
import { isForbiddenKey } from "./safe-json";

/**
 * SIDECAR WBS store (roadmap §4.6, path 3 — "SAP-light for non-ERP customers") — OmniProject's OWN zero-at-rest
 * home for WBS records: the built-in broker's backend, and the basic self-hosted all-in-one model. When a field
 * (or a whole WBS) has no external home, it lives HERE — a project-scoped, AES-256-GCM sealed row set, the same
 * sealing as every def. No ERP, no external broker: the customer authors/imports a WBS + financials and we
 * render + round-trip it through the same mapping the SAP screen uses.
 *
 * Rows are RAW records (`{ <idField>: id, <field>: value, … }`) — deliberately shape-free so the SAME
 * `applyWbsMapping` projects them exactly as it projects an OpenProject/SAP bucket. This module is the read/write
 * seam over the sealed store; the projection stays in `wbs-mapping`.
 */

export const WBS_SIDECAR_ARTIFACT = "wbs-sidecar";
const ROWS_ID = "rows";

export type WbsSidecarRow = Record<string, unknown>;
interface StoredWbsRows { id: string; rows: WbsSidecarRow[] }

const projectScope = (projectId: string): ArtifactScope => ({ kind: "project", projectId });

/** Strip forbidden keys from a row (defence in depth — the write route builds rows from sanitised mapping field
 *  names, but a row that ever carried a `__proto__`/`constructor` key is cleaned before it's sealed). */
function cleanRow(row: WbsSidecarRow): WbsSidecarRow {
  const out: WbsSidecarRow = {};
  for (const [k, v] of Object.entries(row)) if (!isForbiddenKey(k)) out[k] = v;
  return out;
}

/** The sidecar WBS rows for a project (empty when unset / store off). */
export function getSidecarWbs(projectId: string): WbsSidecarRow[] {
  if (!artifactStoreEnabled()) return [];
  return getArtifact<StoredWbsRows>(WBS_SIDECAR_ARTIFACT, projectScope(projectId), ROWS_ID)?.rows ?? [];
}

/** Whether a project has any authored sidecar WBS (⇒ the cost screen reads the sidecar, not an external broker). */
export function hasSidecarWbs(projectId: string): boolean {
  return getSidecarWbs(projectId).length > 0;
}

/** Replace the whole sidecar row set for a project (import / bulk author). Rows are cleaned before sealing. */
export function setSidecarWbs(projectId: string, rows: WbsSidecarRow[]): WbsSidecarRow[] {
  const clean = rows.filter((r) => r && typeof r === "object").map(cleanRow);
  putArtifact<StoredWbsRows>(WBS_SIDECAR_ARTIFACT, projectScope(projectId), { id: ROWS_ID, rows: clean });
  return clean;
}

/**
 * Upsert one WBS row by its id (the `idField` value). Existing fields are MERGED (a write of just `budget`
 * leaves the rest intact), so the SAP-like screen can save field-by-field. Returns the new row set. Throws if
 * the id value is empty.
 */
export function upsertSidecarWbsRow(projectId: string, idField: string, id: string, fields: WbsSidecarRow): WbsSidecarRow[] {
  if (!id) throw new Error("a sidecar WBS row needs a non-empty id");
  const rows = [...getSidecarWbs(projectId)];
  const patch = cleanRow(fields);
  const idx = rows.findIndex((r) => String(r[idField] ?? "") === id);
  if (idx >= 0) rows[idx] = { ...rows[idx], ...patch, [idField]: id };
  else rows.push({ ...patch, [idField]: id });
  return setSidecarWbs(projectId, rows);
}
