/**
 * SCOPE-OVERRIDABLE GTD task-status vocabulary — the resolver + write sanitiser behind
 * `GET`/`PUT /api/task-vocabulary`. The shipped default (assets/task-vocabulary.json, seeded as the
 * system-scope `task-vocabulary` config def) is the base; org/programme/project/user layers fold on top
 * via the shared `resolveConfig` (nearest scope wins, id-keyed arrays merge by id), exactly like the
 * work-item vocabulary next door — and like `scheduling`.
 *
 * This is the TASK axis (GTD next-actions), DISTINCT from the work-item/issue status axis. It KEEPS GTD's
 * richer FIVE workflow classes (actionable/waiting/deferred/done/dropped) — it is NOT collapsed onto the four
 * issue lifecycle classes. STATUSES are fully org-owned: a scope may RELABEL, REORDER, ADD and REMOVE task
 * statuses and tag them by methodology, so an org (or a methodology) runs its own GTD nomenclature. The ONE
 * invariant kept for the actionable/closed/done maths: every effective status must still declare a workflow
 * `class` — a custom status without one is dropped, and the sanitiser requires it on a newly-added status.
 * Removal is a tombstone (`{id, removed:true}`) folded over the base.
 */
import { taskVocabularyValues, type TaskStatusClass, type ResolvedTaskStatus, type TaskVocabularyValues } from "@workspace/backend-catalogue";
import { configDefLayers, resolveScopedConfig, type ConfigScopes } from "./scoped-config";
import { makeScopedId } from "./artifact-store";

export const TASK_VOCABULARY_CONFIG_ID = "task-vocabulary";
/** The singleton org-scope override row id (stable, so a save upserts rather than piling rows). */
export const ORG_TASK_VOCABULARY_ID = makeScopedId("org", `config-${TASK_VOCABULARY_CONFIG_ID}`);

const MAX_LABEL = 40;
const ID_RE = /^[a-z][a-z0-9_]*$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const LOCALE_RE = /^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/;
/** The FIVE GTD workflow classes — the internal invariant every task status binds to (NOT the issue axis). */
const CLASSES = new Set<TaskStatusClass>(["actionable", "waiting", "deferred", "done", "dropped"]);
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
 * The effective GTD task vocabulary at the given scopes: the shipped default with every `task-vocabulary`
 * config-def layer folded on top (system → org → programme → project → user), nearest scope winning within
 * each (id-keyed arrays merge by id). The result is projected (statuses class-required + tombstones removed,
 * validated + sorted).
 */
export function resolveTaskVocabulary(scopes: ConfigScopes = {}): TaskVocabularyValues {
  const layers = configDefLayers(TASK_VOCABULARY_CONFIG_ID, scopes);
  const folded = resolveScopedConfig<Record<string, unknown>>(taskVocabularyValues() as unknown as Record<string, unknown>, layers);
  return { statuses: projectStatuses(folded["statuses"]) };
}

/** Project a folded task-status array: keep only well-formed, non-tombstoned entries (a valid status needs a
 *  label + an order + a workflow class), dedupe by id, default methodology tags, sort by order. Add/remove are
 *  honoured — the set is whatever the folded layers say, not a fixed list. */
function projectStatuses(folded: unknown): ResolvedTaskStatus[] {
  const arr = Array.isArray(folded) ? folded : [];
  const out: ResolvedTaskStatus[] = [];
  const seen = new Set<string>();
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    if (e["removed"] === true) continue;
    const id = e["id"];
    if (!isStr(id) || !ID_RE.test(id) || seen.has(id)) continue;
    const label = cleanLabel(e["label"]);
    if (!label || !isIntGe0(e["order"])) continue;
    const cls = isStr(e["class"]) && CLASSES.has(e["class"] as TaskStatusClass) ? (e["class"] as TaskStatusClass) : null;
    if (!cls) continue;
    const color = cleanColor(e["color"]);
    const labels = cleanLabels(e["labels"]);
    seen.add(id);
    out.push({ id, label, order: e["order"] as number, class: cls, methodologies: cleanMethodologies(e["methodologies"]), ...(labels ? { labels } : {}), ...(color ? { color } : {}) });
  }
  return out.sort((a, b) => a.order - b.order);
}

/** One sanitised task-status override entry — a partial for an existing status, a full def for a new one, or a
 *  `{id, removed}` tombstone. */
export interface TaskStatusOverride { id: string; label?: string; labels?: Record<string, string>; order?: number; class?: TaskStatusClass; methodologies?: string[]; color?: string; removed?: true }

/**
 * Validate + normalise a PUT body into the config-def `values` to store. Throws {@link Error} (→ 400) on a
 * malformed entry. Per status: relabel/reorder/recolour an existing one, tag it by methodology, ADD a new one
 * (id + label + order + a workflow class), or REMOVE a shipped one (`{id, removed:true}`). No-op entries are
 * dropped.
 */
export function sanitizeTaskVocabularyOverride(raw: unknown): { statuses: TaskStatusOverride[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("task vocabulary override must be an object");
  const base = taskVocabularyValues();
  const obj = raw as Record<string, unknown>;
  return { statuses: cleanStatusOverrides(obj["statuses"], new Set(base.statuses.map((s) => s.id))) };
}

function cleanStatusOverrides(list: unknown, baseIds: Set<string>): TaskStatusOverride[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error("statuses must be an array");
  const out: TaskStatusOverride[] = [];
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
    const entry: TaskStatusOverride = { id };
    if (e["label"] !== undefined && e["label"] !== null && e["label"] !== "") {
      if (isStr(e["label"]) && (e["label"] as string).trim().length > MAX_LABEL) throw new Error(`status "${id}" label is too long (max ${MAX_LABEL})`);
      const l = cleanLabel(e["label"]);
      if (!l) throw new Error(`status "${id}" label must be a non-blank string`);
      entry.label = l;
    }
    if (e["class"] !== undefined) {
      if (!isStr(e["class"]) || !CLASSES.has(e["class"] as TaskStatusClass)) throw new Error(`status "${id}" class must be one of actionable/waiting/deferred/done/dropped`);
      entry.class = e["class"] as TaskStatusClass;
    }
    if (e["order"] !== undefined) {
      if (!isIntGe0(e["order"])) throw new Error(`status "${id}" order must be a non-negative integer`);
      entry.order = e["order"] as number;
    }
    if (e["methodologies"] !== undefined) {
      if (!Array.isArray(e["methodologies"]) || !e["methodologies"].every(isStr)) throw new Error(`status "${id}" methodologies must be an array of strings`);
      entry.methodologies = e["methodologies"] as string[];
    }
    if (e["labels"] !== undefined && e["labels"] !== null) {
      if (typeof e["labels"] !== "object" || Array.isArray(e["labels"])) throw new Error(`status "${id}" labels must be an object of locale→text`);
      for (const k of Object.keys(e["labels"] as Record<string, unknown>)) if (!LOCALE_RE.test(k)) throw new Error(`status "${id}" label locale "${k}" is not a valid locale (e.g. "de" or "en-GB")`);
      const cl = cleanLabels(e["labels"]);
      if (cl) entry.labels = cl;
    }
    if (e["color"] !== undefined && e["color"] !== null && e["color"] !== "") {
      const c = cleanColor(e["color"]);
      if (!c) throw new Error(`status "${id}" color must be a 6-digit hex like #3b82f6`);
      entry.color = c;
    }
    if (isNew && (entry.label === undefined || entry.order === undefined || entry.class === undefined)) {
      throw new Error(`new status "${id}" needs a label, a workflow class and an order`);
    }
    if (entry.label !== undefined || entry.labels !== undefined || entry.order !== undefined || entry.class !== undefined || entry.methodologies !== undefined || entry.color !== undefined) out.push(entry);
  }
  return out;
}
