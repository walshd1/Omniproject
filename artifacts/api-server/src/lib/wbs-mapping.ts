import { isForbiddenKey } from "./safe-json";
import type { WbsElement, WbsFinancials } from "../broker/types";
import {
  resolveFieldTarget, sanitizeFieldRef, sanitizeHomeId, targetKey, sameHome,
  BUILTIN_HOME, type FieldRef, type BrokerBackend,
} from "./field-target";

/**
 * WBS field mapping (roadmap §4.6) — the admin-authored layer that lets the SAP-looking cost screen be
 * populated by (and stored in) ANY set of backends: SAP, OpenProject, Jira, or our sidecar. The JSON screen
 * speaks in SEMANTIC fields (wbs / name / budget / actual / …); this maps each to a FIELD TARGET — exactly one
 * (broker, backend) + native field name — via the shared `field-target` spine.
 *
 * N backends through N brokers: every field names its single home. The mapping declares a default `broker` +
 * `backend` (the "home" — where structure lives); each field inherits it unless it routes elsewhere. A field
 * with no home at all falls back to the BUILT-IN broker + SIDECAR backend — the all-in-one self-hosted default.
 * So "structure in OpenProject, some cost figures in SAP, the rest in our sidecar" is one mapping, and with no
 * external brokers configured everything simply lives at home in the sidecar.
 *
 * PURE (no I/O), so it's fully unit-tested and reused by any source (a broker read, a CSV import, the sidecar).
 * A missing mapping just leaves that column empty — nothing is invented. Actually reaching each broker
 * (dispatch) is a separate concern; this projects records already fetched per (broker, backend) bucket.
 */

export interface WbsFieldMapping {
  /** The default home the fields inherit: which broker + backend the WBS STRUCTURE lives in. Absent ⇒ the
   *  built-in broker + sidecar backend (the all-in-one default). */
  broker?: string;
  backend?: string;
  /** Which source field holds the WBS id (required — it's the cost-collecting key). Read from the home. */
  id: string;
  /** Which source field holds the element name (required). Read from the home. */
  name: string;
  /** Optional structure fields (read from the home); absent ⇒ that facet stays empty/zero. */
  parentId?: string;
  status?: string;
  responsible?: string;
  /** Financial facets — each a {@link FieldRef}, so any one may route to its own (broker, backend). */
  budget?: FieldRef;
  actual?: FieldRef;
  commitment?: FieldRef;
  wip?: FieldRef;
  planned?: FieldRef;
  /** A source field carrying the currency, OR — when absent — `currencyDefault`. */
  currency?: FieldRef;
  currencyDefault?: string;
  /** The field carrying the WBS id in NON-home sources, for the join (defaults to the home `id` field name).
   *  Only consulted when a field routes to a different (broker, backend) than the home. */
  joinField?: string;
}

type Src = Record<string, unknown>;

/** Records already fetched, keyed by the composite `(broker, backend)` address ({@link targetKey}). The home's
 *  bucket supplies the WBS structure; other buckets are joined to it by the WBS id. A bare `Src[]` is treated
 *  as the home bucket (the common single-backend case). */
export type WbsSources = Src[] | Record<string, Src[]>;

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

/** The mapping's home (broker, backend) — its declared default, else the built-in fallback. */
export function mappingHome(m: WbsFieldMapping): BrokerBackend {
  return { broker: m.broker ?? BUILTIN_HOME.broker, backend: m.backend ?? BUILTIN_HOME.backend };
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
 * Project the per-bucket records into the WBS read model using a mapping. The WBS STRUCTURE comes from the
 * home bucket's rows; each financial field is read from ITS target bucket — the home row, or a non-home bucket
 * joined by the WBS id. Returns the WBS elements and a by-id financials map
 * (`available = budget − actual − commitment`), exactly the shapes the SAP-looking screen consumes — so
 * OpenProject/Jira/SAP/sidecar rows render through the same JSON, wherever each figure lives.
 */
export function applyWbsMapping(sources: WbsSources, m: WbsFieldMapping, projectId: string): { wbs: WbsElement[]; financials: Record<string, WbsFinancials> } {
  const home = mappingHome(m);
  const homeKey = targetKey(home);
  const buckets: Record<string, Src[]> = Array.isArray(sources) ? { [homeKey]: sources } : sources;
  const rowsOf = (key: string): Src[] => (buckets[key] ?? []).filter((r) => r && typeof r === "object");

  const homeRows = rowsOf(homeKey);
  // Index every NON-home bucket by the join id it carries, so a field routed elsewhere finds its element's row.
  const joinField = m.joinField || m.id;
  const nonHomeIndex = new Map<string, Map<string, Src>>();
  for (const [key, rows] of Object.entries(buckets)) {
    if (key === homeKey) continue;
    const byId = new Map<string, Src>();
    for (const r of rows) {
      if (!r || typeof r !== "object") continue;
      const jid = str(r[joinField]);
      if (jid) byId.set(jid, r);
    }
    nonHomeIndex.set(key, byId);
  }

  const parentOf = new Map<string, string | null>();
  for (const r of homeRows) {
    const id = str(r[m.id]);
    if (id) parentOf.set(id, m.parentId ? (str(r[m.parentId]) || null) : null);
  }

  const wbs: WbsElement[] = [];
  const financials: Record<string, WbsFinancials> = {};
  for (const r of homeRows) {
    const id = str(r[m.id]);
    if (!id) continue;
    const parentId = m.parentId ? (str(r[m.parentId]) || null) : null;
    const el: WbsElement = { id, projectId, parentId, name: str(r[m.name]) || id, level: levelOf(id, parentOf) };
    if (m.status) el.status = str(r[m.status]);
    if (m.responsible) el.responsible = str(r[m.responsible]) || null;
    wbs.push(el);

    /** Read a financial field from whichever (broker, backend) bucket its ref names, joined by this id. */
    const read = (ref: FieldRef | undefined): unknown => {
      if (ref === undefined) return undefined;
      const t = resolveFieldTarget(ref, home);
      const row = sameHome(t, home) ? r : nonHomeIndex.get(targetKey(t))?.get(id);
      return row ? row[t.field] : undefined;
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

/** Validate + coerce an admin-authored mapping (the importer choke point). `id` and `name` are required home
 *  fields; structure fields are home-only strings; financial fields may each carry their own (broker, backend);
 *  every field name must be safe + non-empty. Throws {@link WbsMappingError}. */
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
  // Home (default broker/backend the fields inherit).
  try {
    const broker = sanitizeHomeId("mapping.broker", o["broker"]);
    if (broker !== undefined) out.broker = broker;
    const backend = sanitizeHomeId("mapping.backend", o["backend"]);
    if (backend !== undefined) out.backend = backend;
  } catch (e) { throw new WbsMappingError(e instanceof Error ? e.message : "invalid home"); }
  // Structure facets — home-only field names.
  for (const k of ["parentId", "status", "responsible"] as const) {
    const v = strField(k, false);
    if (v !== undefined) out[k] = v;
  }
  // Financial facets — per-field (broker, backend) refs.
  for (const k of ["budget", "actual", "commitment", "wip", "planned", "currency"] as const) {
    try {
      const v = sanitizeFieldRef(`mapping.${k}`, o[k]);
      if (v !== undefined) out[k] = v;
    } catch (e) { throw new WbsMappingError(e instanceof Error ? e.message : `invalid mapping.${k}`); }
  }
  if (typeof o["currencyDefault"] === "string" && o["currencyDefault"]) out.currencyDefault = o["currencyDefault"];
  const joinField = strField("joinField", false);
  if (joinField !== undefined) out.joinField = joinField;
  return out;
}
