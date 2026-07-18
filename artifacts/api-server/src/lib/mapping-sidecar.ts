import { getArtifact, putArtifact, artifactStoreEnabled } from "./artifact-store";
import { isForbiddenKey } from "./safe-json";

/**
 * GENERIC SIDECAR record store (roadmap §4.6, "across the board") — the built-in broker's backend for ANY mapped
 * surface, not just WBS: a project-scoped, AES-256-GCM sealed row set PER slot. When a field (or a whole record)
 * has no external home, it lives here — the all-in-one self-hosted model, for a form, a report, a custom screen,
 * whatever slot the mapping names. Rows are RAW records so the same `projectMappingRows` renders them.
 *
 * Storage: one sealed collection `mapping-sidecar` at project scope, one artifact per slot (id = slot). The
 * dedicated `wbs-sidecar` store remains for the WBS surface (it carries WBS-specific financial semantics); this
 * is the generic sibling every other surface uses.
 */

export const MAPPING_SIDECAR_ARTIFACT = "mapping-sidecar";

export type SidecarRow = Record<string, unknown>;
interface StoredSlotRows { id: string; rows: SidecarRow[] }

const projectScope = (projectId: string) => ({ kind: "project" as const, projectId });

/** Strip forbidden keys before sealing (defence in depth). */
function cleanRow(row: SidecarRow): SidecarRow {
  const out: SidecarRow = {};
  for (const [k, v] of Object.entries(row)) if (!isForbiddenKey(k)) out[k] = v;
  return out;
}

/** The sidecar rows for a (project, slot) — empty when unset / store off. */
export function getSidecarRows(projectId: string, slot: string): SidecarRow[] {
  if (!artifactStoreEnabled()) return [];
  return getArtifact<StoredSlotRows>(MAPPING_SIDECAR_ARTIFACT, projectScope(projectId), slot)?.rows ?? [];
}

/** Whether a (project, slot) has any authored sidecar rows. */
export function hasSidecarRows(projectId: string, slot: string): boolean {
  return getSidecarRows(projectId, slot).length > 0;
}

/** Replace the whole row set for a (project, slot). Rows are cleaned before sealing. */
export function setSidecarRows(projectId: string, slot: string, rows: SidecarRow[]): SidecarRow[] {
  const clean = rows.filter((r) => r && typeof r === "object").map(cleanRow);
  putArtifact<StoredSlotRows>(MAPPING_SIDECAR_ARTIFACT, projectScope(projectId), { id: slot, rows: clean });
  return clean;
}

/** Upsert one row by its id (merge existing fields), keyed on `idField`. Throws on an empty id. */
export function upsertSidecarRow(projectId: string, slot: string, idField: string, id: string, fields: SidecarRow): SidecarRow[] {
  if (!id) throw new Error("a sidecar row needs a non-empty id");
  const rows = [...getSidecarRows(projectId, slot)];
  const patch = cleanRow(fields);
  const idx = rows.findIndex((r) => String(r[idField] ?? "") === id);
  if (idx >= 0) rows[idx] = { ...rows[idx], ...patch, [idField]: id };
  else rows.push({ ...patch, [idField]: id });
  return setSidecarRows(projectId, slot, rows);
}

/** Remove one row by its `idField` value (a no-op when absent / store off). Completes the generic slot CRUD
 *  so any slot — a form, a report, the dependency graph — can delete a row without a bespoke endpoint. */
export function removeSidecarRow(projectId: string, slot: string, idField: string, id: string): SidecarRow[] {
  if (!artifactStoreEnabled()) return [];
  const rows = getSidecarRows(projectId, slot).filter((r) => String(r[idField] ?? "") !== id);
  return setSidecarRows(projectId, slot, rows);
}
