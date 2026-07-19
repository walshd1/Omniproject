/**
 * SCOPE-OVERRIDABLE work-item vocabulary — the resolver + write sanitiser behind
 * `GET`/`PUT /api/work-vocabulary`. The shipped default (assets/work-vocabulary.json, seeded as the
 * system-scope `work-vocabulary` config def) is the base; org/programme/project/user layers fold on top
 * via the shared `resolveConfig` (nearest scope wins, id-keyed arrays merge by id), like `scheduling`.
 *
 * STATUSES are fully org-owned: a scope may RELABEL, REORDER, ADD and REMOVE statuses and tag them by
 * methodology, so an org runs its own nomenclature regardless of what the broker's native payload calls a
 * state (the native⇄canonical dialect in broker/vocabulary maps the wire value onto whatever the org's set
 * calls it). The ONE invariant kept for the completion/RAG maths: every effective status must still declare
 * a lifecycle class (open/active/done/cancelled) — a custom status without one is dropped, and the sanitiser
 * requires it on a newly-added status. Removal is a tombstone (`{id, removed:true}`) folded over the base.
 *
 * PRIORITIES stay a FIXED rank scale (the shipped five) — an override may only relabel/reorder them; add
 * and remove are a status-only capability. Both boundaries are enforced on read (projection) and write.
 */
import { workVocabularyValues, type StatusClass, type ResolvedStatus, type ResolvedPriority, type WorkVocabularyValues } from "@workspace/backend-catalogue";
import { resolveConfig, type ConfigScopes } from "./scoped-config";
import { makeScopedId } from "./artifact-store";

export const WORK_VOCABULARY_CONFIG_ID = "work-vocabulary";
/** The singleton org-scope override row id (stable, so a save upserts rather than piling rows). */
export const ORG_WORK_VOCABULARY_ID = makeScopedId("org", `config-${WORK_VOCABULARY_CONFIG_ID}`);

const MAX_LABEL = 40;
const ID_RE = /^[a-z][a-z0-9_]*$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const LIFECYCLES = new Set<StatusClass>(["open", "active", "done", "cancelled"]);
const isStr = (v: unknown): v is string => typeof v === "string";
const isIntGe0 = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const cleanLabel = (v: unknown): string | null => (isStr(v) && v.trim() ? v.trim().slice(0, MAX_LABEL) : null);
const cleanColor = (v: unknown): string | null => (isStr(v) && HEX_RE.test(v) ? v : null);
const cleanMethodologies = (v: unknown): string[] => (Array.isArray(v) && v.length && v.every(isStr) ? (v as string[]) : ["*"]);

/** The effective vocabulary at the given scopes — the shipped default with every scope layer folded on,
 *  then projected: statuses validated (lifecycle-required, tombstones removed) and sorted; priorities
 *  re-projected onto the fixed shipped set with only label/order overrides applied. */
export function resolveWorkVocabulary(scopes: ConfigScopes = {}): WorkVocabularyValues {
  const folded = resolveConfig<Record<string, unknown>>(WORK_VOCABULARY_CONFIG_ID, workVocabularyValues() as unknown as Record<string, unknown>, scopes);
  return { statuses: projectStatuses(folded["statuses"]), priorities: projectPriorities(folded["priorities"]) };
}

/** Project a folded status array: keep only well-formed, non-tombstoned entries (a valid status needs a
 *  label, a lifecycle class and an order), dedupe by id, default methodology tags, sort by order. Add/remove
 *  are honoured here — the set is whatever the folded layers say, not a fixed canonical list. */
function projectStatuses(folded: unknown): ResolvedStatus[] {
  const arr = Array.isArray(folded) ? folded : [];
  const out: ResolvedStatus[] = [];
  const seen = new Set<string>();
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    if (e["removed"] === true) continue;
    const id = e["id"];
    if (!isStr(id) || !ID_RE.test(id) || seen.has(id)) continue;
    const label = cleanLabel(e["label"]);
    const lifecycle = isStr(e["lifecycle"]) && LIFECYCLES.has(e["lifecycle"] as StatusClass) ? (e["lifecycle"] as StatusClass) : null;
    if (!label || !lifecycle || !isIntGe0(e["order"])) continue;
    const color = cleanColor(e["color"]);
    seen.add(id);
    out.push({ id, label, order: e["order"] as number, lifecycle, methodologies: cleanMethodologies(e["methodologies"]), ...(color ? { color } : {}) });
  }
  return out.sort((a, b) => a.order - b.order);
}

/** Project priorities onto the FIXED shipped set: apply only a non-blank label + integer order from the
 *  folded layer, keep the shipped id set + membership, sort by the effective order. */
function projectPriorities(folded: unknown): ResolvedPriority[] {
  const base = workVocabularyValues().priorities;
  const over = new Map<string, Record<string, unknown>>();
  if (Array.isArray(folded)) for (const e of folded) if (e && typeof e === "object" && isStr((e as { id?: unknown }).id)) over.set((e as { id: string }).id, e as Record<string, unknown>);
  return base
    .map((p) => {
      const o = over.get(p.id);
      const color = cleanColor(o?.["color"]) ?? p.color;
      return { id: p.id, label: cleanLabel(o?.["label"]) ?? p.label, order: isIntGe0(o?.["order"]) ? (o!["order"] as number) : p.order, ...(color ? { color } : {}) };
    })
    .sort((a, b) => a.order - b.order);
}

/** One sanitised status override entry — a partial for an existing status, a full def for a new one, or a
 *  `{id, removed}` tombstone. */
export interface StatusOverride { id: string; label?: string; order?: number; lifecycle?: StatusClass; methodologies?: string[]; color?: string; removed?: true }
export interface PriorityOverride { id: string; label?: string; order?: number; color?: string }

/**
 * Validate + normalise a PUT body into the config-def `values` to store. Throws {@link Error} (→ 400) on a
 * malformed entry. STATUSES: relabel/reorder an existing status (partial), ADD a new one (id + label +
 * lifecycle + order all required), or REMOVE a shipped one (`{id, removed:true}`). PRIORITIES: relabel/reorder
 * only, canonical ids. No-op entries are dropped.
 */
export function sanitizeWorkVocabularyOverride(raw: unknown): { statuses: StatusOverride[]; priorities: PriorityOverride[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("work vocabulary override must be an object");
  const base = workVocabularyValues();
  const baseStatusIds = new Set(base.statuses.map((s) => s.id));
  const priorityIds = new Set(base.priorities.map((p) => p.id));
  const obj = raw as Record<string, unknown>;
  return { statuses: cleanStatusOverrides(obj["statuses"], baseStatusIds), priorities: cleanPriorityOverrides(obj["priorities"], priorityIds) };
}

function cleanStatusOverrides(list: unknown, baseIds: Set<string>): StatusOverride[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error("statuses must be an array");
  const out: StatusOverride[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") throw new Error("each status entry must be an object");
    const e = raw as Record<string, unknown>;
    const id = e["id"];
    if (!isStr(id) || !ID_RE.test(id)) throw new Error(`status id "${String(id)}" must be a lower-case slug`);
    if (e["removed"] === true) {
      if (!baseIds.has(id)) throw new Error(`cannot remove unknown status "${id}"`);
      out.push({ id, removed: true });
      continue;
    }
    const isNew = !baseIds.has(id);
    const entry: StatusOverride = { id };
    if (e["label"] !== undefined && e["label"] !== null && e["label"] !== "") {
      const l = cleanLabel(e["label"]);
      if (!l) throw new Error(`status "${id}" label must be a non-blank string (max ${MAX_LABEL})`);
      if (isStr(e["label"]) && (e["label"] as string).trim().length > MAX_LABEL) throw new Error(`status "${id}" label is too long (max ${MAX_LABEL})`);
      entry.label = l;
    }
    if (e["lifecycle"] !== undefined) {
      if (!isStr(e["lifecycle"]) || !LIFECYCLES.has(e["lifecycle"] as StatusClass)) throw new Error(`status "${id}" lifecycle must be one of open/active/done/cancelled`);
      entry.lifecycle = e["lifecycle"] as StatusClass;
    }
    if (e["order"] !== undefined) {
      if (!isIntGe0(e["order"])) throw new Error(`status "${id}" order must be a non-negative integer`);
      entry.order = e["order"] as number;
    }
    if (e["methodologies"] !== undefined) {
      if (!Array.isArray(e["methodologies"]) || !e["methodologies"].every(isStr)) throw new Error(`status "${id}" methodologies must be an array of strings`);
      entry.methodologies = e["methodologies"] as string[];
    }
    if (e["color"] !== undefined && e["color"] !== null && e["color"] !== "") {
      const c = cleanColor(e["color"]);
      if (!c) throw new Error(`status "${id}" color must be a 6-digit hex like #3b82f6`);
      entry.color = c;
    }
    if (isNew && (entry.label === undefined || entry.lifecycle === undefined || entry.order === undefined)) {
      throw new Error(`new status "${id}" needs a label, a lifecycle class and an order`);
    }
    if (entry.label !== undefined || entry.order !== undefined || entry.lifecycle !== undefined || entry.methodologies !== undefined || entry.color !== undefined) out.push(entry);
  }
  return out;
}

function cleanPriorityOverrides(list: unknown, allowed: Set<string>): PriorityOverride[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error("priorities must be an array");
  const out: PriorityOverride[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") throw new Error("each priority entry must be an object");
    const e = raw as Record<string, unknown>;
    const id = e["id"];
    if (!isStr(id) || !allowed.has(id)) throw new Error(`priority id "${String(id)}" is not a canonical priority`);
    const entry: PriorityOverride = { id };
    if (e["label"] !== undefined && e["label"] !== null && e["label"] !== "") {
      const l = cleanLabel(e["label"]);
      if (!l) throw new Error(`priority "${id}" label must be a non-blank string (max ${MAX_LABEL})`);
      if (isStr(e["label"]) && (e["label"] as string).trim().length > MAX_LABEL) throw new Error(`priority "${id}" label is too long (max ${MAX_LABEL})`);
      entry.label = l;
    }
    if (e["order"] !== undefined) {
      if (!isIntGe0(e["order"])) throw new Error(`priority "${id}" order must be a non-negative integer`);
      entry.order = e["order"] as number;
    }
    if (e["color"] !== undefined && e["color"] !== null && e["color"] !== "") {
      const c = cleanColor(e["color"]);
      if (!c) throw new Error(`priority "${id}" color must be a 6-digit hex like #ef4444`);
      entry.color = c;
    }
    if (entry.label !== undefined || entry.order !== undefined || entry.color !== undefined) out.push(entry);
  }
  return out;
}
