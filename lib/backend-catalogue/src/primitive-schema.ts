/**
 * PRIMITIVE BUNDLE SCHEMA + validator — the shared, closed-set definition of what a `primitive` registry
 * payload must look like (a `PrimitiveDef`: a declarative, code-free chart/graphic descriptor). This is the
 * SERVER-SIDE + shared source of truth so a generated or hand-authored primitive bundle can be *tested*
 * before it is stored — the SPA's `components/charts/catalogue.ts` (`PrimitiveDef` / `PrimitiveParamType`)
 * and `ChartView.tsx` (`ChartViewSpec["type"]`) are the runtime rendering side; a drift guard in the SPA
 * asserts the shipped catalogue only ever uses the sets defined here, so the two can never diverge.
 *
 * Pure data + a pure validator — no React, no I/O. `validatePrimitiveDef` COLLECTS every problem (it never
 * throws) so an authoring tool can show all of them at once.
 */

/** The category a primitive is grouped under (mirrors the SPA `PrimitiveCategory`). */
export type PrimitiveCategory = "chart" | "graphic" | "table" | "tile";
export const PRIMITIVE_CATEGORIES: readonly PrimitiveCategory[] = ["chart", "graphic", "table", "tile"];

/** The kind of value a primitive parameter carries (mirrors the SPA `PrimitiveParamType`). */
export type PrimitiveParamType =
  | "rows" | "series" | "slices" | "points" | "tree" | "items" | "nodes" | "geo" | "columns"
  | "string" | "number" | "boolean" | "palette" | "enum";
export const PRIMITIVE_PARAM_TYPES: readonly PrimitiveParamType[] = [
  "rows", "series", "slices", "points", "tree", "items", "nodes", "geo", "columns",
  "string", "number", "boolean", "palette", "enum",
];

/** The ChartView spec type a chart primitive draws through (mirrors the SPA `ChartViewSpec["type"]`). */
export type ChartViewType = "bar" | "line" | "area" | "pie" | "donut" | "scatter" | "treemap" | "gantt";
export const CHART_VIEW_TYPES: readonly ChartViewType[] = ["bar", "line", "area", "pie", "donut", "scatter", "treemap", "gantt"];

/** A primitive parameter (an authoring input). */
export interface PrimitiveParamShape {
  key: string;
  label: string;
  type: PrimitiveParamType;
  required: boolean;
  description: string;
  /** For `enum` params — the allowed values. */
  options?: string[];
}

/** A primitive definition — the payload of a `primitive` registry item. */
export interface PrimitiveDefShape {
  id: string;
  label: string;
  category: PrimitiveCategory;
  description: string;
  /** When it's a ChartView-dispatchable chart, the spec type it draws through. */
  chartType?: ChartViewType;
  params: PrimitiveParamShape[];
}

/** The outcome of validating a primitive bundle: every problem, and the normalised def when clean. */
export interface PrimitiveValidation {
  ok: boolean;
  errors: string[];
  def?: PrimitiveDefShape;
}

const PARAM_TYPE_SET = new Set<string>(PRIMITIVE_PARAM_TYPES);
const CATEGORY_SET = new Set<string>(PRIMITIVE_CATEGORIES);
const CHART_TYPE_SET = new Set<string>(CHART_VIEW_TYPES);
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Validate a primitive-bundle payload against the shared schema. Never throws — returns `{ ok, errors, def }`.
 * `def` is the normalised `PrimitiveDefShape` when `ok`, else undefined. This is the deterministic "test" an
 * authoring tool runs on a generated or pasted primitive before it may be stored.
 */
export function validatePrimitiveDef(raw: unknown): PrimitiveValidation {
  const errors: string[] = [];
  const o = (raw ?? {}) as Record<string, unknown>;

  const id = str(o["id"]);
  if (!id) errors.push("id is required");
  else if (!ID_RE.test(id)) errors.push('id must be kebab-case (lowercase letters, digits and hyphens), e.g. "grouped-column"');

  const label = str(o["label"]);
  if (!label) errors.push("label is required");

  const category = str(o["category"]);
  if (!category) errors.push("category is required");
  else if (!CATEGORY_SET.has(category)) errors.push(`category must be one of ${PRIMITIVE_CATEGORIES.join(", ")}`);

  const description = typeof o["description"] === "string" ? o["description"].trim() : "";

  let chartType: ChartViewType | undefined;
  if (o["chartType"] !== undefined && o["chartType"] !== null) {
    const ct = str(o["chartType"]);
    if (!CHART_TYPE_SET.has(ct)) errors.push(`chartType must be one of ${CHART_VIEW_TYPES.join(", ")}`);
    else chartType = ct as ChartViewType;
  }

  const params: PrimitiveParamShape[] = [];
  const rawParams = o["params"];
  if (!Array.isArray(rawParams) || rawParams.length === 0) {
    errors.push("params must be a non-empty array");
  } else {
    const keys = new Set<string>();
    rawParams.forEach((rp, i) => {
      const p = (rp ?? {}) as Record<string, unknown>;
      const key = str(p["key"]);
      const plabel = str(p["label"]);
      const type = str(p["type"]);
      if (!key) errors.push(`params[${i}]: key is required`);
      else if (keys.has(key)) errors.push(`params[${i}]: duplicate key "${key}"`);
      else keys.add(key);
      if (!plabel) errors.push(`params[${i}] (${key || "?"}): label is required`);
      if (!type) errors.push(`params[${i}] (${key || "?"}): type is required`);
      else if (!PARAM_TYPE_SET.has(type)) errors.push(`params[${i}] (${key || "?"}): type must be one of ${PRIMITIVE_PARAM_TYPES.join(", ")}`);
      const required = p["required"];
      if (typeof required !== "boolean") errors.push(`params[${i}] (${key || "?"}): required must be a boolean`);
      const pdesc = typeof p["description"] === "string" ? p["description"] : "";
      let options: string[] | undefined;
      if (type === "enum") {
        options = Array.isArray(p["options"]) ? (p["options"] as unknown[]).map(str).filter(Boolean) : [];
        if (options.length === 0) errors.push(`params[${i}] (${key || "?"}): an enum param needs a non-empty options array`);
      }
      if (key && plabel && PARAM_TYPE_SET.has(type) && typeof required === "boolean") {
        params.push({ key, label: plabel, type: type as PrimitiveParamType, required, description: pdesc, ...(options && options.length ? { options } : {}) });
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    def: { id, label, category: category as PrimitiveCategory, description, ...(chartType ? { chartType } : {}), params },
  };
}
