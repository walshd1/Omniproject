/**
 * SCOPE-OVERRIDABLE GTD task-context vocabulary — the resolver + write sanitiser behind
 * `GET`/`PUT /api/task-context-vocabulary`. The shipped default (assets/task-context-vocabulary.json, seeded
 * as the system-scope `task-context-vocabulary` config def) is the base; org/programme/project/user layers
 * fold on top via the shared `resolveScopedConfig` (nearest scope wins, id-keyed arrays merge by id), exactly
 * like the energy vocabulary next door.
 *
 * This is the CONTEXT axis of a GTD next-action (David Allen's "where / with what tool"). CONTEXTS are fully
 * org-owned: a scope may RELABEL, REORDER, RECOLOUR, ADD and REMOVE contexts and tag them by methodology.
 * Unlike the energy axis there is NO ordinal `level` — a context is a set member with a display `order`, not
 * a scale — so the sanitiser requires only an id + label + order on a newly-added context. Removal is a
 * tombstone (`{id, removed:true}`) folded over the base. Note: `Task.context` stays FREE-TEXT at the write
 * boundary (GTD encourages ad-hoc contexts); this vocabulary is the curated/suggested set for pickers,
 * colours and grouping, not a closed enum.
 */
import { taskContextVocabularyValues, type ResolvedTaskContext, type TaskContextVocabularyValues } from "@workspace/backend-catalogue";
import { configDefLayers, resolveScopedConfig, type ConfigScopes } from "./scoped-config";
import { makeScopedId } from "./artifact-store";

export const TASK_CONTEXT_VOCABULARY_CONFIG_ID = "task-context-vocabulary";
/** The singleton org-scope override row id (stable, so a save upserts rather than piling rows). */
export const ORG_TASK_CONTEXT_VOCABULARY_ID = makeScopedId("org", `config-${TASK_CONTEXT_VOCABULARY_CONFIG_ID}`);

const MAX_LABEL = 40;
const ID_RE = /^[a-z][a-z0-9_]*$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const LOCALE_RE = /^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/;
const isStr = (v: unknown): v is string => typeof v === "string";
const isIntGe0 = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const cleanLabel = (v: unknown): string | null => (isStr(v) && v.trim() ? v.trim().slice(0, MAX_LABEL) : null);
const cleanColor = (v: unknown): string | null => (isStr(v) && HEX_RE.test(v) ? v : null);
const cleanMethodologies = (v: unknown): string[] => (Array.isArray(v) && v.length && v.every(isStr) ? (v as string[]) : ["*"]);
/** Keep only well-formed locale→text pairs (BCP-47-ish key, non-blank capped value); null when none survive. */
const cleanLabels = (v: unknown): Record<string, string> | null => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const l = cleanLabel(val);
    if (LOCALE_RE.test(k) && l) out[k] = l;
  }
  return Object.keys(out).length ? out : null;
};

/**
 * The effective GTD task-context vocabulary at the given scopes: the shipped default with every
 * `task-context-vocabulary` config-def layer folded on top (system → org → programme → project → user),
 * nearest scope winning within each (id-keyed arrays merge by id). The result is projected (well-formed +
 * tombstones removed, validated + order-sorted).
 */
export function resolveTaskContextVocabulary(scopes: ConfigScopes = {}): TaskContextVocabularyValues {
  const layers = configDefLayers(TASK_CONTEXT_VOCABULARY_CONFIG_ID, scopes);
  const folded = resolveScopedConfig<Record<string, unknown>>(taskContextVocabularyValues() as unknown as Record<string, unknown>, layers);
  return { contexts: projectContexts(folded["contexts"]) };
}

/** Project a folded context array: keep only well-formed, non-tombstoned entries (a valid context needs a
 *  label + an order), dedupe by id, default methodology tags, sort by order. Add/remove are honoured — the
 *  set is whatever the folded layers say, not a fixed list. */
function projectContexts(folded: unknown): ResolvedTaskContext[] {
  const arr = Array.isArray(folded) ? folded : [];
  const out: ResolvedTaskContext[] = [];
  const seen = new Set<string>();
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    if (e["removed"] === true) continue;
    const id = e["id"];
    if (!isStr(id) || !ID_RE.test(id) || seen.has(id)) continue;
    const label = cleanLabel(e["label"]);
    if (!label || !isIntGe0(e["order"])) continue;
    const color = cleanColor(e["color"]);
    const labels = cleanLabels(e["labels"]);
    seen.add(id);
    out.push({ id, label, order: e["order"] as number, methodologies: cleanMethodologies(e["methodologies"]), ...(labels ? { labels } : {}), ...(color ? { color } : {}) });
  }
  return out.sort((a, b) => a.order - b.order);
}

/** One sanitised context override entry — a partial for an existing context, a full def for a new one, or a
 *  `{id, removed}` tombstone. */
export interface TaskContextOverride { id: string; label?: string; labels?: Record<string, string>; order?: number; methodologies?: string[]; color?: string; removed?: true }

/**
 * Validate + normalise a PUT body into the config-def `values` to store. Throws {@link Error} (→ 400) on a
 * malformed entry. Per context: relabel/reorder/recolour an existing one, tag it by methodology, ADD a new
 * one (id + label + order), or REMOVE a shipped one (`{id, removed:true}`). No-op entries are dropped.
 */
export function sanitizeTaskContextVocabularyOverride(raw: unknown): { contexts: TaskContextOverride[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("task context vocabulary override must be an object");
  const base = taskContextVocabularyValues();
  const obj = raw as Record<string, unknown>;
  return { contexts: cleanContextOverrides(obj["contexts"], new Set(base.contexts.map((c) => c.id))) };
}

function cleanContextOverrides(list: unknown, baseIds: Set<string>): TaskContextOverride[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error("contexts must be an array");
  const out: TaskContextOverride[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") throw new Error("each context entry must be an object");
    const e = raw as Record<string, unknown>;
    const id = e["id"];
    if (!isStr(id) || !ID_RE.test(id)) throw new Error(`context id "${String(id)}" must be a lower-case slug`);
    if (e["removed"] === true) {
      if (!baseIds.has(id)) throw new Error(`cannot remove unknown context "${id}"`);
      out.push({ id, removed: true });
      continue;
    }
    const isNew = !baseIds.has(id);
    const entry: TaskContextOverride = { id };
    if (e["label"] !== undefined && e["label"] !== null && e["label"] !== "") {
      if (isStr(e["label"]) && (e["label"] as string).trim().length > MAX_LABEL) throw new Error(`context "${id}" label is too long (max ${MAX_LABEL})`);
      const l = cleanLabel(e["label"]);
      if (!l) throw new Error(`context "${id}" label must be a non-blank string`);
      entry.label = l;
    }
    if (e["order"] !== undefined) {
      if (!isIntGe0(e["order"])) throw new Error(`context "${id}" order must be a non-negative integer`);
      entry.order = e["order"] as number;
    }
    if (e["methodologies"] !== undefined) {
      if (!Array.isArray(e["methodologies"]) || !e["methodologies"].every(isStr)) throw new Error(`context "${id}" methodologies must be an array of strings`);
      entry.methodologies = e["methodologies"] as string[];
    }
    if (e["labels"] !== undefined && e["labels"] !== null) {
      if (typeof e["labels"] !== "object" || Array.isArray(e["labels"])) throw new Error(`context "${id}" labels must be an object of locale→text`);
      for (const k of Object.keys(e["labels"] as Record<string, unknown>)) if (!LOCALE_RE.test(k)) throw new Error(`context "${id}" label locale "${k}" is not a valid locale (e.g. "de" or "en-GB")`);
      const cl = cleanLabels(e["labels"]);
      if (cl) entry.labels = cl;
    }
    if (e["color"] !== undefined && e["color"] !== null && e["color"] !== "") {
      const c = cleanColor(e["color"]);
      if (!c) throw new Error(`context "${id}" color must be a 6-digit hex like #22c55e`);
      entry.color = c;
    }
    if (isNew && (entry.label === undefined || entry.order === undefined)) {
      throw new Error(`new context "${id}" needs a label and an order`);
    }
    if (entry.label !== undefined || entry.labels !== undefined || entry.order !== undefined || entry.methodologies !== undefined || entry.color !== undefined) out.push(entry);
  }
  return out;
}
