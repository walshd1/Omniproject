import { isForbiddenKey } from "./safe-json";
import type { WbsElement, WbsFinancials } from "../broker/types";

/**
 * WBS field mapping (roadmap §4.6) — the admin-authored layer that lets the SAP-looking cost screen be
 * populated by (and stored in) ANY backend: SAP, OpenProject, Jira, or the sidecar. The JSON screen speaks in
 * SEMANTIC fields (wbs / name / budget / actual / …); this maps each to the SOURCE field key in a given
 * backend's records, so the same screen renders regardless of where the data lives — the same idea as
 * `fieldOverrides` / `column-mapper`, applied to the WBS read model.
 *
 * PURE (no I/O), so it's fully unit-tested and reused by any source (a broker read, a CSV import, the
 * sidecar). A missing mapping just leaves that column empty — nothing is invented.
 */
export interface WbsFieldMapping {
  /** Which source field holds the WBS id (required — it's the cost-collecting key). */
  id: string;
  /** Which source field holds the element name (required). */
  name: string;
  /** Optional source fields; absent ⇒ that facet stays empty/zero. */
  parentId?: string;
  status?: string;
  responsible?: string;
  budget?: string;
  actual?: string;
  commitment?: string;
  wip?: string;
  planned?: string;
  /** A source field carrying the currency, OR — when absent — `currencyDefault`. */
  currency?: string;
  currencyDefault?: string;
}

type Src = Record<string, unknown>;

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
const pick = (row: Src, key: string | undefined): unknown => (key ? row[key] : undefined);

/** Depth of a WBS element in the parent chain (root = 1); guards against cycles. */
function levelOf(id: string, parentOf: Map<string, string | null>): number {
  let level = 1;
  const seen = new Set<string>([id]);
  let p = parentOf.get(id) ?? null;
  while (p && parentOf.has(p) && !seen.has(p)) { level++; seen.add(p); p = parentOf.get(p) ?? null; }
  return level;
}

/**
 * Project arbitrary backend records into the WBS read model using a mapping. Returns the WBS elements and a
 * by-id financials map (`available = budget − actual − commitment`), exactly the shapes the SAP-looking screen
 * consumes — so OpenProject/Jira/sidecar rows render through the same JSON.
 */
export function applyWbsMapping(rows: Src[], m: WbsFieldMapping, projectId: string): { wbs: WbsElement[]; financials: Record<string, WbsFinancials> } {
  const clean = rows.filter((r) => r && typeof r === "object");
  const parentOf = new Map<string, string | null>();
  for (const r of clean) {
    const id = str(pick(r, m.id));
    if (id) parentOf.set(id, m.parentId ? (str(pick(r, m.parentId)) || null) : null);
  }
  const wbs: WbsElement[] = [];
  const financials: Record<string, WbsFinancials> = {};
  for (const r of clean) {
    const id = str(pick(r, m.id));
    if (!id) continue;
    const parentId = m.parentId ? (str(pick(r, m.parentId)) || null) : null;
    const el: WbsElement = { id, projectId, parentId, name: str(pick(r, m.name)) || id, level: levelOf(id, parentOf) };
    if (m.status) el.status = str(pick(r, m.status));
    if (m.responsible) el.responsible = str(pick(r, m.responsible)) || null;
    wbs.push(el);

    const budget = num(pick(r, m.budget));
    const actual = num(pick(r, m.actual));
    const commitment = num(pick(r, m.commitment));
    financials[id] = {
      wbsId: id,
      currency: (m.currency ? str(pick(r, m.currency)) : "") || m.currencyDefault || "GBP",
      budget, actual, commitment,
      wip: num(pick(r, m.wip)),
      planned: num(pick(r, m.planned)),
      available: budget - actual - commitment,
    };
  }
  return { wbs, financials };
}

export class WbsMappingError extends Error {
  constructor(message: string) { super(message); this.name = "WbsMappingError"; }
}

/** Validate + coerce an admin-authored mapping (the importer choke point). `id` and `name` are required source
 *  fields; every mapped key must be a safe, non-empty string. Throws {@link WbsMappingError}. */
export function sanitizeWbsMapping(raw: unknown): WbsFieldMapping {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new WbsMappingError("mapping must be an object");
  const o = raw as Record<string, unknown>;
  const field = (key: string, required: boolean): string | undefined => {
    const v = o[key];
    if (v === undefined || v === null || v === "") {
      if (required) throw new WbsMappingError(`mapping.${key} is required`);
      return undefined;
    }
    if (typeof v !== "string" || isForbiddenKey(v)) throw new WbsMappingError(`mapping.${key} must be a safe field name`);
    return v;
  };
  const out: WbsFieldMapping = { id: field("id", true)!, name: field("name", true)! };
  for (const k of ["parentId", "status", "responsible", "budget", "actual", "commitment", "wip", "planned", "currency"] as const) {
    const v = field(k, false);
    if (v !== undefined) out[k] = v;
  }
  if (typeof o["currencyDefault"] === "string" && o["currencyDefault"]) out.currencyDefault = o["currencyDefault"];
  return out;
}
