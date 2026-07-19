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
import { configDefLayers, resolveScopedConfig, type ConfigScopes } from "./scoped-config";
import { ACCESSIBILITY_CONFIG_ID } from "./user-prefs";
import { makeScopedId } from "./artifact-store";

export const WORK_VOCABULARY_CONFIG_ID = "work-vocabulary";
/** The singleton org-scope override row id (stable, so a save upserts rather than piling rows). */
export const ORG_WORK_VOCABULARY_ID = makeScopedId("org", `config-${WORK_VOCABULARY_CONFIG_ID}`);
/** The dedicated i18n config (same scope-layered pattern as accessibility): every user can hold their own
 *  `i18n` JSON whose `workVocabulary` section overrides labels/translations. Sits just below accessibility. */
export const I18N_CONFIG_ID = "i18n";

const MAX_LABEL = 40;
const ID_RE = /^[a-z][a-z0-9_]*$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const LOCALE_RE = /^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/;
const LIFECYCLES = new Set<StatusClass>(["open", "active", "done", "cancelled"]);
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

/** Pull each layer's `workVocabulary` override section for a config id (system→…→user order preserved). */
function vocabOverrideLayers(configId: string, scopes: ConfigScopes): Record<string, unknown>[] {
  return configDefLayers(configId, scopes)
    .map((l) => (l as Record<string, unknown>)["workVocabulary"])
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v));
}

/** The effective vocabulary at the given scopes. Layers fold low → high, nearest scope winning within each:
 *    shipped default → work-vocabulary (system→org→programme→project→user)
 *      → i18n config's `workVocabulary` (same scope order — a user's own i18n JSON)
 *      → accessibility config's `workVocabulary` (same scope order — a user's own accessibility JSON, FINAL).
 *  So a user's accessibility beats their i18n, which beats the org's vocabulary. The result is projected
 *  (statuses lifecycle-required + tombstones removed, both token kinds validated + sorted). */
export function resolveWorkVocabulary(scopes: ConfigScopes = {}): WorkVocabularyValues {
  const layers: unknown[] = [
    ...configDefLayers(WORK_VOCABULARY_CONFIG_ID, scopes),
    ...vocabOverrideLayers(I18N_CONFIG_ID, scopes), // i18n sits below accessibility
    ...vocabOverrideLayers(ACCESSIBILITY_CONFIG_ID, scopes), // accessibility is the final (highest) layer
  ];
  const folded = resolveScopedConfig<Record<string, unknown>>(workVocabularyValues() as unknown as Record<string, unknown>, layers);
  return {
    statuses: projectTokens(folded["statuses"], true) as ResolvedStatus[],
    priorities: projectTokens(folded["priorities"], false) as ResolvedPriority[],
  };
}

/** Project a folded token array (statuses or priorities): keep only well-formed, non-tombstoned entries
 *  (a valid token needs a label + an order; a status additionally needs a lifecycle class), dedupe by id,
 *  default methodology tags, sort by order. Add/remove are honoured — the set is whatever the folded
 *  layers say, not a fixed list. `requireLifecycle` is the only status/priority difference. */
function projectTokens(folded: unknown, requireLifecycle: boolean): Array<ResolvedStatus | ResolvedPriority> {
  const arr = Array.isArray(folded) ? folded : [];
  const out: Array<ResolvedStatus | ResolvedPriority> = [];
  const seen = new Set<string>();
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    if (e["removed"] === true) continue;
    const id = e["id"];
    if (!isStr(id) || !ID_RE.test(id) || seen.has(id)) continue;
    const label = cleanLabel(e["label"]);
    if (!label || !isIntGe0(e["order"])) continue;
    let lifecycle: StatusClass | null = null;
    if (requireLifecycle) {
      lifecycle = isStr(e["lifecycle"]) && LIFECYCLES.has(e["lifecycle"] as StatusClass) ? (e["lifecycle"] as StatusClass) : null;
      if (!lifecycle) continue;
    }
    const color = cleanColor(e["color"]);
    const labels = cleanLabels(e["labels"]);
    seen.add(id);
    out.push({ id, label, order: e["order"] as number, methodologies: cleanMethodologies(e["methodologies"]), ...(lifecycle ? { lifecycle } : {}), ...(labels ? { labels } : {}), ...(color ? { color } : {}) } as ResolvedStatus | ResolvedPriority);
  }
  return out.sort((a, b) => a.order - b.order);
}

/** One sanitised status override entry — a partial for an existing status, a full def for a new one, or a
 *  `{id, removed}` tombstone. */
export interface TokenOverride { id: string; label?: string; labels?: Record<string, string>; order?: number; lifecycle?: StatusClass; methodologies?: string[]; color?: string; removed?: true }

/**
 * Validate + normalise a PUT body into the config-def `values` to store. Throws {@link Error} (→ 400) on a
 * malformed entry. STATUSES and PRIORITIES are symmetric: relabel/reorder/recolour an existing token, tag it
 * by methodology, ADD a new one (id + label + order — and a lifecycle class for a status), or REMOVE a shipped
 * one (`{id, removed:true}`). The ONLY difference is the lifecycle class, which is status-only. No-op entries
 * are dropped.
 */
export function sanitizeWorkVocabularyOverride(raw: unknown): { statuses: TokenOverride[]; priorities: TokenOverride[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("work vocabulary override must be an object");
  const base = workVocabularyValues();
  const obj = raw as Record<string, unknown>;
  return {
    statuses: cleanTokenOverrides(obj["statuses"], new Set(base.statuses.map((s) => s.id)), true, "status"),
    priorities: cleanTokenOverrides(obj["priorities"], new Set(base.priorities.map((p) => p.id)), false, "priority"),
  };
}

function cleanTokenOverrides(list: unknown, baseIds: Set<string>, allowLifecycle: boolean, kind: string): TokenOverride[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error(`${kind}es must be an array`);
  const out: TokenOverride[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") throw new Error(`each ${kind} entry must be an object`);
    const e = raw as Record<string, unknown>;
    const id = e["id"];
    if (!isStr(id) || !ID_RE.test(id)) throw new Error(`${kind} id "${String(id)}" must be a lower-case slug`);
    if (e["removed"] === true) {
      if (!baseIds.has(id)) throw new Error(`cannot remove unknown ${kind} "${id}"`);
      out.push({ id, removed: true });
      continue;
    }
    const isNew = !baseIds.has(id);
    const entry: TokenOverride = { id };
    if (e["label"] !== undefined && e["label"] !== null && e["label"] !== "") {
      if (isStr(e["label"]) && (e["label"] as string).trim().length > MAX_LABEL) throw new Error(`${kind} "${id}" label is too long (max ${MAX_LABEL})`);
      const l = cleanLabel(e["label"]);
      if (!l) throw new Error(`${kind} "${id}" label must be a non-blank string`);
      entry.label = l;
    }
    if (e["lifecycle"] !== undefined) {
      if (!allowLifecycle) throw new Error(`a ${kind} has no lifecycle class`);
      if (!isStr(e["lifecycle"]) || !LIFECYCLES.has(e["lifecycle"] as StatusClass)) throw new Error(`${kind} "${id}" lifecycle must be one of open/active/done/cancelled`);
      entry.lifecycle = e["lifecycle"] as StatusClass;
    }
    if (e["order"] !== undefined) {
      if (!isIntGe0(e["order"])) throw new Error(`${kind} "${id}" order must be a non-negative integer`);
      entry.order = e["order"] as number;
    }
    if (e["methodologies"] !== undefined) {
      if (!Array.isArray(e["methodologies"]) || !e["methodologies"].every(isStr)) throw new Error(`${kind} "${id}" methodologies must be an array of strings`);
      entry.methodologies = e["methodologies"] as string[];
    }
    if (e["labels"] !== undefined && e["labels"] !== null) {
      if (typeof e["labels"] !== "object" || Array.isArray(e["labels"])) throw new Error(`${kind} "${id}" labels must be an object of locale→text`);
      for (const k of Object.keys(e["labels"] as Record<string, unknown>)) if (!LOCALE_RE.test(k)) throw new Error(`${kind} "${id}" label locale "${k}" is not a valid locale (e.g. "de" or "en-GB")`);
      const cl = cleanLabels(e["labels"]);
      if (cl) entry.labels = cl;
    }
    if (e["color"] !== undefined && e["color"] !== null && e["color"] !== "") {
      const c = cleanColor(e["color"]);
      if (!c) throw new Error(`${kind} "${id}" color must be a 6-digit hex like #3b82f6`);
      entry.color = c;
    }
    if (isNew && (entry.label === undefined || entry.order === undefined || (allowLifecycle && entry.lifecycle === undefined))) {
      throw new Error(`new ${kind} "${id}" needs a label${allowLifecycle ? ", a lifecycle class" : ""} and an order`);
    }
    if (entry.label !== undefined || entry.labels !== undefined || entry.order !== undefined || entry.lifecycle !== undefined || entry.methodologies !== undefined || entry.color !== undefined) out.push(entry);
  }
  return out;
}
