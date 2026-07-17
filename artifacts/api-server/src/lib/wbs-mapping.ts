import { isForbiddenKey } from "./safe-json";
import type { WbsElement, WbsFinancials } from "../broker/types";

/**
 * WBS field mapping (roadmap §4.6) — the admin-authored layer that lets the SAP-looking cost screen be
 * populated by (and stored in) ANY backend: SAP, OpenProject, Jira, or the sidecar. The JSON screen speaks in
 * SEMANTIC fields (wbs / name / budget / actual / …); this maps each to the SOURCE field key in a given
 * backend's records, so the same screen renders regardless of where the data lives — the same idea as
 * `fieldOverrides` / `column-mapper`, applied to the WBS read model.
 *
 * PER-FIELD STORAGE TARGET (the user's fuller vision): "some fields map to OpenProject and some map to our
 * sidecar". Each field value is EITHER a bare source-field name (⇒ the `backend` target — the broker's records)
 * OR `{ target, field }` where `target` picks WHERE that field lives. Structure (id/name/parent/status/
 * responsible) always comes from the backend (it's what the broker structures); the FINANCIAL facets may each
 * be sourced from the backend OR the zero-at-rest sidecar, joined by the WBS id. So a project can look like SAP,
 * read its structure from OpenProject, and hold its cost figures in our sidecar — all from one mapping.
 *
 * PURE (no I/O), so it's fully unit-tested and reused by any source (a broker read, a CSV import, the
 * sidecar). A missing mapping just leaves that column empty — nothing is invented.
 */

/** Where a mapped field's value lives. `backend` = the broker's records (SAP / OpenProject / Jira / …);
 *  `sidecar` = OmniProject's own zero-at-rest sidecar store, joined to the backend by the WBS id. */
export type WbsTarget = "backend" | "sidecar";
export const WBS_TARGETS: readonly WbsTarget[] = ["backend", "sidecar"];

/** A field reference: a bare source-field name (⇒ `backend`) or an explicit `{ target, field }`. */
export type FieldRef = string | { target: WbsTarget; field: string };

export interface WbsFieldMapping {
  /** Which source field holds the WBS id (required — it's the cost-collecting key). Structure ⇒ backend. */
  id: string;
  /** Which source field holds the element name (required). Structure ⇒ backend. */
  name: string;
  /** Optional structure fields (backend only); absent ⇒ that facet stays empty/zero. */
  parentId?: string;
  status?: string;
  responsible?: string;
  /** Financial facets — each a {@link FieldRef}, so they can be sourced per-field from backend OR sidecar. */
  budget?: FieldRef;
  actual?: FieldRef;
  commitment?: FieldRef;
  wip?: FieldRef;
  planned?: FieldRef;
  /** A source field carrying the currency, OR — when absent — `currencyDefault`. */
  currency?: FieldRef;
  currencyDefault?: string;
  /** The field in SIDECAR rows that carries the WBS id, for the join (defaults to the backend `id` field name).
   *  Only consulted when a financial field targets the sidecar. */
  sidecarId?: string;
}

type Src = Record<string, unknown>;

/** The records available to project, one array per storage target. A bare `Src[]` is treated as backend-only. */
export interface WbsSources {
  backend: Src[];
  sidecar?: Src[];
}

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
/** Parse a numeric amount from a source cell — tolerates "480000", "£480,000", 480000. NaN ⇒ 0. */
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.-]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Normalise a {@link FieldRef} to `{ target, field }` (bare string ⇒ backend). */
function ref(r: FieldRef | undefined): { target: WbsTarget; field: string } | undefined {
  if (r === undefined) return undefined;
  if (typeof r === "string") return r ? { target: "backend", field: r } : undefined;
  return r.field ? { target: r.target, field: r.field } : undefined;
}

/** Depth of a WBS element in the parent chain (root = 1); guards against cycles. */
function levelOf(id: string, parentOf: Map<string, string | null>): number {
  let level = 1;
  const seen = new Set<string>([id]);
  let p = parentOf.get(id) ?? null;
  while (p && parentOf.has(p) && !seen.has(p)) { level++; seen.add(p); p = parentOf.get(p) ?? null; }
  return level;
}

/**
 * Project backend (+ optional sidecar) records into the WBS read model using a mapping. Structure comes from
 * the backend rows; each financial field is read from ITS target — backend row, or the sidecar row joined by
 * the WBS id. Returns the WBS elements and a by-id financials map (`available = budget − actual − commitment`),
 * exactly the shapes the SAP-looking screen consumes — so OpenProject/Jira/sidecar rows render through the same
 * JSON, whether the figures live in the tracker or our sidecar.
 */
export function applyWbsMapping(sources: Src[] | WbsSources, m: WbsFieldMapping, projectId: string): { wbs: WbsElement[]; financials: Record<string, WbsFinancials> } {
  const src: WbsSources = Array.isArray(sources) ? { backend: sources } : sources;
  const backend = src.backend.filter((r) => r && typeof r === "object");
  // Sidecar rows indexed by the WBS id they carry (its own id field, defaulting to the backend's id field name).
  const sidecarIdField = m.sidecarId || m.id;
  const sidecarById = new Map<string, Src>();
  for (const r of (src.sidecar ?? [])) {
    if (!r || typeof r !== "object") continue;
    const sid = str(r[sidecarIdField]);
    if (sid) sidecarById.set(sid, r);
  }

  const parentOf = new Map<string, string | null>();
  for (const r of backend) {
    const id = str(r[m.id]);
    if (id) parentOf.set(id, m.parentId ? (str(r[m.parentId]) || null) : null);
  }

  const wbs: WbsElement[] = [];
  const financials: Record<string, WbsFinancials> = {};
  for (const r of backend) {
    const id = str(r[m.id]);
    if (!id) continue;
    const parentId = m.parentId ? (str(r[m.parentId]) || null) : null;
    const el: WbsElement = { id, projectId, parentId, name: str(r[m.name]) || id, level: levelOf(id, parentOf) };
    if (m.status) el.status = str(r[m.status]);
    if (m.responsible) el.responsible = str(r[m.responsible]) || null;
    wbs.push(el);

    const sidecarRow = sidecarById.get(id);
    /** Read a financial field from whichever target its ref names, joined by this element's id. */
    const read = (r0: FieldRef | undefined): unknown => {
      const rr = ref(r0);
      if (!rr) return undefined;
      const row = rr.target === "sidecar" ? sidecarRow : r;
      return row ? row[rr.field] : undefined;
    };

    const budget = num(read(m.budget));
    const actual = num(read(m.actual));
    const commitment = num(read(m.commitment));
    financials[id] = {
      wbsId: id,
      currency: str(read(m.currency)) || m.currencyDefault || "GBP",
      budget, actual, commitment,
      wip: num(read(m.wip)),
      planned: num(read(m.planned)),
      available: budget - actual - commitment,
    };
  }
  return { wbs, financials };
}

export class WbsMappingError extends Error {
  constructor(message: string) { super(message); this.name = "WbsMappingError"; }
}

/** Validate + coerce one {@link FieldRef}. A bare string ⇒ backend; an object must name a known target + a safe
 *  field. Throws {@link WbsMappingError}. Returns undefined for an absent field. */
function sanitizeRef(key: string, v: unknown): FieldRef | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "string") {
    if (isForbiddenKey(v)) throw new WbsMappingError(`mapping.${key} must be a safe field name`);
    return v;
  }
  if (typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const target = o["target"];
    const field = o["field"];
    if (target !== "backend" && target !== "sidecar") throw new WbsMappingError(`mapping.${key}.target must be one of ${WBS_TARGETS.join(", ")}`);
    if (typeof field !== "string" || !field || isForbiddenKey(field)) throw new WbsMappingError(`mapping.${key}.field must be a safe field name`);
    return { target, field };
  }
  throw new WbsMappingError(`mapping.${key} must be a field name or { target, field }`);
}

/** Validate + coerce an admin-authored mapping (the importer choke point). `id` and `name` are required backend
 *  fields; structure fields are backend-only strings; financial fields may be per-target refs; every field name
 *  must be safe + non-empty. Throws {@link WbsMappingError}. */
export function sanitizeWbsMapping(raw: unknown): WbsFieldMapping {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new WbsMappingError("mapping must be an object");
  const o = raw as Record<string, unknown>;
  const strField = (key: string, required: boolean): string | undefined => {
    const v = o[key];
    if (v === undefined || v === null || v === "") {
      if (required) throw new WbsMappingError(`mapping.${key} is required`);
      return undefined;
    }
    if (typeof v !== "string" || isForbiddenKey(v)) throw new WbsMappingError(`mapping.${key} must be a safe field name`);
    return v;
  };
  const out: WbsFieldMapping = { id: strField("id", true)!, name: strField("name", true)! };
  // Structure facets — backend-only field names.
  for (const k of ["parentId", "status", "responsible"] as const) {
    const v = strField(k, false);
    if (v !== undefined) out[k] = v;
  }
  // Financial facets — per-target refs.
  for (const k of ["budget", "actual", "commitment", "wip", "planned", "currency"] as const) {
    const v = sanitizeRef(k, o[k]);
    if (v !== undefined) out[k] = v;
  }
  if (typeof o["currencyDefault"] === "string" && o["currencyDefault"]) out.currencyDefault = o["currencyDefault"];
  const sidecarId = strField("sidecarId", false);
  if (sidecarId !== undefined) out.sidecarId = sidecarId;
  return out;
}
