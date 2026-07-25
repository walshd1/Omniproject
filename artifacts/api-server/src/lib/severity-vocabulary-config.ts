/**
 * SCOPE-OVERRIDABLE RAID/risk SEVERITY vocabulary — the resolver + write sanitiser behind
 * `GET`/`PUT /api/severity-vocabulary`. The shipped default (assets/severity-vocabulary.json, seeded as the
 * system-scope `severity-vocabulary` config def) is the base; org/programme/project/user layers fold on top
 * via the shared `resolveConfig` (nearest scope wins, id-keyed arrays merge by id), exactly like the energy
 * (GTD tank) vocabulary next door — and like `scheduling`.
 *
 * This is the SEVERITY axis of a RAID/risk entry ("how bad is it if this bites"). GRADES are fully org-owned:
 * a scope may RELABEL, REORDER, ADD and REMOVE severity grades and tag them by methodology. The ONE invariant
 * kept for the risk-exposure maths (P×I): every effective grade must still declare an internal ordinal
 * `level` — a custom grade without one is dropped, and the sanitiser requires it on a newly-added grade. That
 * ordinal is what {@link resolveRiskExposure} keys off (snapped onto the nearest shipped band, so a scope-added
 * grade still yields a bounded number). Removal is a tombstone (`{id, removed:true}`) folded over the base.
 */
import { severityVocabularyValues, type ResolvedSeverity, type SeverityVocabularyValues } from "@workspace/backend-catalogue";
import { configDefLayers, resolveScopedConfig, type ConfigScopes } from "./scoped-config";
import { makeScopedId } from "./artifact-store";

export const SEVERITY_VOCABULARY_CONFIG_ID = "severity-vocabulary";
/** The singleton org-scope override row id (stable, so a save upserts rather than piling rows). */
export const ORG_SEVERITY_VOCABULARY_ID = makeScopedId("org", `config-${SEVERITY_VOCABULARY_CONFIG_ID}`);

const MAX_LABEL = 40;
const ID_RE = /^[a-z][a-z0-9_]*$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const LOCALE_RE = /^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/;
const isStr = (v: unknown): v is string => typeof v === "string";
const isIntGe0 = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isIntGe1 = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;
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
 * The effective RAID/risk severity vocabulary at the given scopes: the shipped default with every
 * `severity-vocabulary` config-def layer folded on top (system → org → programme → project → user), nearest
 * scope winning within each (id-keyed arrays merge by id). The result is projected (grades ordinal-required +
 * tombstones removed, validated + sorted).
 */
export function resolveSeverityVocabulary(scopes: ConfigScopes = {}): SeverityVocabularyValues {
  const layers = configDefLayers(SEVERITY_VOCABULARY_CONFIG_ID, scopes);
  const folded = resolveScopedConfig<Record<string, unknown>>(severityVocabularyValues() as unknown as Record<string, unknown>, layers);
  return { levels: projectLevels(folded["levels"]) };
}

/** Project a folded severity-grade array: keep only well-formed, non-tombstoned entries (a valid grade needs a
 *  label + an order + an ordinal `level`), dedupe by id, default methodology tags, sort by order. Add/remove
 *  are honoured — the set is whatever the folded layers say, not a fixed list. */
function projectLevels(folded: unknown): ResolvedSeverity[] {
  const arr = Array.isArray(folded) ? folded : [];
  const out: ResolvedSeverity[] = [];
  const seen = new Set<string>();
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    if (e["removed"] === true) continue;
    const id = e["id"];
    if (!isStr(id) || !ID_RE.test(id) || seen.has(id)) continue;
    const label = cleanLabel(e["label"]);
    if (!label || !isIntGe0(e["order"])) continue;
    const level = isIntGe1(e["level"]) ? (e["level"] as number) : null;
    if (level === null) continue;
    const color = cleanColor(e["color"]);
    const labels = cleanLabels(e["labels"]);
    seen.add(id);
    out.push({ id, label, order: e["order"] as number, level, methodologies: cleanMethodologies(e["methodologies"]), ...(labels ? { labels } : {}), ...(color ? { color } : {}) });
  }
  return out.sort((a, b) => a.order - b.order);
}

/** One sanitised severity-grade override entry — a partial for an existing grade, a full def for a new one, or
 *  a `{id, removed}` tombstone. */
export interface SeverityGradeOverride { id: string; label?: string; labels?: Record<string, string>; order?: number; level?: number; methodologies?: string[]; color?: string; removed?: true }

/**
 * Validate + normalise a PUT body into the config-def `values` to store. Throws {@link Error} (→ 400) on a
 * malformed entry. Per grade: relabel/reorder/recolour an existing one, tag it by methodology, ADD a new one
 * (id + label + order + an ordinal `level`), or REMOVE a shipped one (`{id, removed:true}`). No-op entries are
 * dropped.
 */
export function sanitizeSeverityVocabularyOverride(raw: unknown): { levels: SeverityGradeOverride[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("severity vocabulary override must be an object");
  const base = severityVocabularyValues();
  const obj = raw as Record<string, unknown>;
  return { levels: cleanLevelOverrides(obj["levels"], new Set(base.levels.map((l) => l.id))) };
}

function cleanLevelOverrides(list: unknown, baseIds: Set<string>): SeverityGradeOverride[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error("levels must be an array");
  const out: SeverityGradeOverride[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") throw new Error("each grade entry must be an object");
    const e = raw as Record<string, unknown>;
    const id = e["id"];
    if (!isStr(id) || !ID_RE.test(id)) throw new Error(`grade id "${String(id)}" must be a lower-case slug`);
    if (e["removed"] === true) {
      if (!baseIds.has(id)) throw new Error(`cannot remove unknown grade "${id}"`);
      out.push({ id, removed: true });
      continue;
    }
    const isNew = !baseIds.has(id);
    const entry: SeverityGradeOverride = { id };
    if (e["label"] !== undefined && e["label"] !== null && e["label"] !== "") {
      if (isStr(e["label"]) && (e["label"] as string).trim().length > MAX_LABEL) throw new Error(`grade "${id}" label is too long (max ${MAX_LABEL})`);
      const l = cleanLabel(e["label"]);
      if (!l) throw new Error(`grade "${id}" label must be a non-blank string`);
      entry.label = l;
    }
    if (e["level"] !== undefined) {
      if (!isIntGe1(e["level"])) throw new Error(`grade "${id}" level must be a positive integer (its ordinal band)`);
      entry.level = e["level"] as number;
    }
    if (e["order"] !== undefined) {
      if (!isIntGe0(e["order"])) throw new Error(`grade "${id}" order must be a non-negative integer`);
      entry.order = e["order"] as number;
    }
    if (e["methodologies"] !== undefined) {
      if (!Array.isArray(e["methodologies"]) || !e["methodologies"].every(isStr)) throw new Error(`grade "${id}" methodologies must be an array of strings`);
      entry.methodologies = e["methodologies"] as string[];
    }
    if (e["labels"] !== undefined && e["labels"] !== null) {
      if (typeof e["labels"] !== "object" || Array.isArray(e["labels"])) throw new Error(`grade "${id}" labels must be an object of locale→text`);
      for (const k of Object.keys(e["labels"] as Record<string, unknown>)) if (!LOCALE_RE.test(k)) throw new Error(`grade "${id}" label locale "${k}" is not a valid locale (e.g. "de" or "en-GB")`);
      const cl = cleanLabels(e["labels"]);
      if (cl) entry.labels = cl;
    }
    if (e["color"] !== undefined && e["color"] !== null && e["color"] !== "") {
      const c = cleanColor(e["color"]);
      if (!c) throw new Error(`grade "${id}" color must be a 6-digit hex like #ef4444`);
      entry.color = c;
    }
    if (isNew && (entry.label === undefined || entry.order === undefined || entry.level === undefined)) {
      throw new Error(`new grade "${id}" needs a label, an ordinal level and an order`);
    }
    if (entry.label !== undefined || entry.labels !== undefined || entry.order !== undefined || entry.level !== undefined || entry.methodologies !== undefined || entry.color !== undefined) out.push(entry);
  }
  return out;
}
