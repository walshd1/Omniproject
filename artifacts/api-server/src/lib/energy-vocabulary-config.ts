/**
 * SCOPE-OVERRIDABLE GTD energy-level vocabulary — the resolver + write sanitiser behind
 * `GET`/`PUT /api/energy-vocabulary`. The shipped default (assets/energy-vocabulary.json, seeded as the
 * system-scope `energy-vocabulary` config def) is the base; org/programme/project/user layers fold on top
 * via the shared `resolveConfig` (nearest scope wins, id-keyed arrays merge by id), exactly like the task
 * (GTD status) vocabulary next door — and like `scheduling`.
 *
 * This is the ENERGY axis (David Allen's "how much have I got in the tank" filter), orthogonal to an hour
 * estimate. LEVELS are fully org-owned: a scope may RELABEL, REORDER, ADD and REMOVE energy levels and tag
 * them by methodology. The ONE invariant kept for the ordering/filtering maths: every effective level must
 * still declare an internal ordinal `level` — a custom level without one is dropped, and the sanitiser
 * requires it on a newly-added level. Removal is a tombstone (`{id, removed:true}`) folded over the base.
 */
import { energyVocabularyValues, type ResolvedEnergy, type EnergyVocabularyValues } from "@workspace/backend-catalogue";
import { configDefLayers, resolveScopedConfig, type ConfigScopes } from "./scoped-config";
import { makeScopedId } from "./artifact-store";

export const ENERGY_VOCABULARY_CONFIG_ID = "energy-vocabulary";
/** The singleton org-scope override row id (stable, so a save upserts rather than piling rows). */
export const ORG_ENERGY_VOCABULARY_ID = makeScopedId("org", `config-${ENERGY_VOCABULARY_CONFIG_ID}`);

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
 * The effective GTD energy vocabulary at the given scopes: the shipped default with every `energy-vocabulary`
 * config-def layer folded on top (system → org → programme → project → user), nearest scope winning within
 * each (id-keyed arrays merge by id). The result is projected (levels ordinal-required + tombstones removed,
 * validated + sorted).
 */
export function resolveEnergyVocabulary(scopes: ConfigScopes = {}): EnergyVocabularyValues {
  const layers = configDefLayers(ENERGY_VOCABULARY_CONFIG_ID, scopes);
  const folded = resolveScopedConfig<Record<string, unknown>>(energyVocabularyValues() as unknown as Record<string, unknown>, layers);
  return { levels: projectLevels(folded["levels"]) };
}

/** Project a folded energy-level array: keep only well-formed, non-tombstoned entries (a valid level needs a
 *  label + an order + an ordinal `level`), dedupe by id, default methodology tags, sort by order. Add/remove
 *  are honoured — the set is whatever the folded layers say, not a fixed list. */
function projectLevels(folded: unknown): ResolvedEnergy[] {
  const arr = Array.isArray(folded) ? folded : [];
  const out: ResolvedEnergy[] = [];
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

/** One sanitised energy-level override entry — a partial for an existing level, a full def for a new one, or a
 *  `{id, removed}` tombstone. */
export interface EnergyLevelOverride { id: string; label?: string; labels?: Record<string, string>; order?: number; level?: number; methodologies?: string[]; color?: string; removed?: true }

/**
 * Validate + normalise a PUT body into the config-def `values` to store. Throws {@link Error} (→ 400) on a
 * malformed entry. Per level: relabel/reorder/recolour an existing one, tag it by methodology, ADD a new one
 * (id + label + order + an ordinal `level`), or REMOVE a shipped one (`{id, removed:true}`). No-op entries are
 * dropped.
 */
export function sanitizeEnergyVocabularyOverride(raw: unknown): { levels: EnergyLevelOverride[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("energy vocabulary override must be an object");
  const base = energyVocabularyValues();
  const obj = raw as Record<string, unknown>;
  return { levels: cleanLevelOverrides(obj["levels"], new Set(base.levels.map((l) => l.id))) };
}

function cleanLevelOverrides(list: unknown, baseIds: Set<string>): EnergyLevelOverride[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error("levels must be an array");
  const out: EnergyLevelOverride[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") throw new Error("each level entry must be an object");
    const e = raw as Record<string, unknown>;
    const id = e["id"];
    if (!isStr(id) || !ID_RE.test(id)) throw new Error(`level id "${String(id)}" must be a lower-case slug`);
    if (e["removed"] === true) {
      if (!baseIds.has(id)) throw new Error(`cannot remove unknown level "${id}"`);
      out.push({ id, removed: true });
      continue;
    }
    const isNew = !baseIds.has(id);
    const entry: EnergyLevelOverride = { id };
    if (e["label"] !== undefined && e["label"] !== null && e["label"] !== "") {
      if (isStr(e["label"]) && (e["label"] as string).trim().length > MAX_LABEL) throw new Error(`level "${id}" label is too long (max ${MAX_LABEL})`);
      const l = cleanLabel(e["label"]);
      if (!l) throw new Error(`level "${id}" label must be a non-blank string`);
      entry.label = l;
    }
    if (e["level"] !== undefined) {
      if (!isIntGe1(e["level"])) throw new Error(`level "${id}" level must be a positive integer (its ordinal band)`);
      entry.level = e["level"] as number;
    }
    if (e["order"] !== undefined) {
      if (!isIntGe0(e["order"])) throw new Error(`level "${id}" order must be a non-negative integer`);
      entry.order = e["order"] as number;
    }
    if (e["methodologies"] !== undefined) {
      if (!Array.isArray(e["methodologies"]) || !e["methodologies"].every(isStr)) throw new Error(`level "${id}" methodologies must be an array of strings`);
      entry.methodologies = e["methodologies"] as string[];
    }
    if (e["labels"] !== undefined && e["labels"] !== null) {
      if (typeof e["labels"] !== "object" || Array.isArray(e["labels"])) throw new Error(`level "${id}" labels must be an object of locale→text`);
      for (const k of Object.keys(e["labels"] as Record<string, unknown>)) if (!LOCALE_RE.test(k)) throw new Error(`level "${id}" label locale "${k}" is not a valid locale (e.g. "de" or "en-GB")`);
      const cl = cleanLabels(e["labels"]);
      if (cl) entry.labels = cl;
    }
    if (e["color"] !== undefined && e["color"] !== null && e["color"] !== "") {
      const c = cleanColor(e["color"]);
      if (!c) throw new Error(`level "${id}" color must be a 6-digit hex like #22c55e`);
      entry.color = c;
    }
    if (isNew && (entry.label === undefined || entry.order === undefined || entry.level === undefined)) {
      throw new Error(`new level "${id}" needs a label, an ordinal level and an order`);
    }
    if (entry.label !== undefined || entry.labels !== undefined || entry.order !== undefined || entry.level !== undefined || entry.methodologies !== undefined || entry.color !== undefined) out.push(entry);
  }
  return out;
}
