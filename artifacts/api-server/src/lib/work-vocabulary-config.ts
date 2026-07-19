/**
 * SCOPE-OVERRIDABLE work-item vocabulary — the resolver + write sanitiser behind
 * `GET`/`PUT /api/work-vocabulary`. The shipped default (assets/work-vocabulary.json, seeded as the
 * system-scope `work-vocabulary` config def) is the base; org/programme/project/user layers fold on top
 * via the shared `resolveConfig` (nearest scope wins), exactly like `scheduling` and `priority-labels`.
 *
 * BOUNDARY (kept deliberately tight so this can't destabilise the neutral wire contract): an override may
 * only RELABEL and REORDER the shipped statuses/priorities. It can NOT add or remove a status/priority, and
 * it can NOT change a status's lifecycle class (open/active/done/cancelled) — those stay canonical, because
 * `Issue.status` on the wire, the synonym normaliser and the completion/RAG maths all key off the fixed set.
 * The boundary is enforced on BOTH axes: the PUT sanitiser rejects out-of-set ids, and the resolver
 * re-projects the folded result onto the canonical base so a hand-imported config def can't widen it either.
 */
import { workVocabularyValues, type WorkVocabularyValues } from "@workspace/backend-catalogue";
import { resolveConfig, type ConfigScopes } from "./scoped-config";
import { makeScopedId } from "./artifact-store";

export const WORK_VOCABULARY_CONFIG_ID = "work-vocabulary";
/** The singleton org-scope override row id (stable, so a save upserts rather than piling rows). */
export const ORG_WORK_VOCABULARY_ID = makeScopedId("org", `config-${WORK_VOCABULARY_CONFIG_ID}`);

const MAX_LABEL = 40;

/** One overridable vocabulary entry as it is stored/returned: the fixed id plus a label + order. */
export interface VocabEntryOverride { id: string; label?: string; order?: number }

/** The effective vocabulary at the given scopes — the shipped default with every scope layer folded on,
 *  then re-projected onto the canonical set (label/order overrides applied, lifecycle + membership fixed),
 *  each list sorted by its resolved order. */
export function resolveWorkVocabulary(scopes: ConfigScopes = {}): WorkVocabularyValues {
  const folded = resolveConfig<WorkVocabularyValues>(WORK_VOCABULARY_CONFIG_ID, workVocabularyValues(), scopes);
  return projectOntoCanonical(folded);
}

/** Re-project a folded vocabulary onto the canonical base: keep the shipped id set + lifecycle, apply only a
 *  non-blank string label and an integer order from the folded layer, then sort by the effective order. */
function projectOntoCanonical(folded: Partial<WorkVocabularyValues>): WorkVocabularyValues {
  const base = workVocabularyValues();
  const index = (arr: unknown): Map<string, Record<string, unknown>> => {
    const m = new Map<string, Record<string, unknown>>();
    if (Array.isArray(arr)) for (const e of arr) if (e && typeof e === "object" && typeof (e as { id?: unknown }).id === "string") m.set((e as { id: string }).id, e as Record<string, unknown>);
    return m;
  };
  const overLabel = (o: Record<string, unknown> | undefined, fallback: string): string => {
    const l = o?.["label"];
    return typeof l === "string" && l.trim() ? l.trim().slice(0, MAX_LABEL) : fallback;
  };
  const overOrder = (o: Record<string, unknown> | undefined, fallback: number): number => {
    const n = o?.["order"];
    return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : fallback;
  };
  const rs = index(folded.statuses);
  const rp = index(folded.priorities);
  return {
    statuses: base.statuses
      .map((s) => ({ id: s.id, label: overLabel(rs.get(s.id), s.label), order: overOrder(rs.get(s.id), s.order), lifecycle: s.lifecycle }))
      .sort((a, b) => a.order - b.order),
    priorities: base.priorities
      .map((p) => ({ id: p.id, label: overLabel(rp.get(p.id), p.label), order: overOrder(rp.get(p.id), p.order) }))
      .sort((a, b) => a.order - b.order),
  };
}

/** Validate + normalise a PUT body into the config-def `values` to store: only canonical ids survive, labels
 *  are trimmed/capped (blank ⇒ dropped, so the canonical label shows), orders must be non-negative integers.
 *  Throws {@link Error} (→ 400) on an out-of-set id or a malformed field. Entries with no override are dropped. */
export function sanitizeWorkVocabularyOverride(raw: unknown): { statuses: VocabEntryOverride[]; priorities: VocabEntryOverride[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("work vocabulary override must be an object");
  const base = workVocabularyValues();
  const statusIds = new Set(base.statuses.map((s) => s.id));
  const priorityIds = new Set(base.priorities.map((p) => p.id));
  const clean = (list: unknown, allowed: Set<string>, kind: string): VocabEntryOverride[] => {
    if (list === undefined) return [];
    if (!Array.isArray(list)) throw new Error(`${kind} must be an array`);
    const out: VocabEntryOverride[] = [];
    for (const raw2 of list) {
      if (!raw2 || typeof raw2 !== "object") throw new Error(`each ${kind} entry must be an object`);
      const e = raw2 as Record<string, unknown>;
      const id = e["id"];
      if (typeof id !== "string" || !allowed.has(id)) throw new Error(`${kind} id "${String(id)}" is not a canonical ${kind.slice(0, -3)}`);
      const entry: VocabEntryOverride = { id };
      if (e["label"] !== undefined && e["label"] !== null && e["label"] !== "") {
        if (typeof e["label"] !== "string") throw new Error(`${kind} "${id}" label must be a string`);
        const t = (e["label"] as string).trim();
        if (t.length > MAX_LABEL) throw new Error(`${kind} "${id}" label is too long (max ${MAX_LABEL})`);
        if (t) entry.label = t;
      }
      if (e["order"] !== undefined) {
        const n = e["order"];
        if (typeof n !== "number" || !Number.isInteger(n) || n < 0) throw new Error(`${kind} "${id}" order must be a non-negative integer`);
        entry.order = n;
      }
      if (entry.label !== undefined || entry.order !== undefined) out.push(entry);
    }
    return out;
  };
  const obj = raw as Record<string, unknown>;
  return { statuses: clean(obj["statuses"], statusIds, "statuses"), priorities: clean(obj["priorities"], priorityIds, "priorities") };
}
