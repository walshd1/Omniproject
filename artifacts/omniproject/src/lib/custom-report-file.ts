import type { CustomReportDef, CustomReportAgg, CustomReportMetric } from "./custom-report";
import type { ConditionSet } from "./rate-card";
import { type StyleSpec, FONT_CHOICES } from "./artifact-style";
import { safeParseJson } from "./safe-json";
import { triggerBlobDownload } from "./setup";

/**
 * Round-trip a bespoke report DEFINITION in and out of a JSON file — so a report built in the generator
 * can be exported, shared, version-controlled and re-imported (into this or another deployment). Pure
 * (parse/serialise/validate only); the file is just the CustomReportDef, the same shape stored in config.
 */

const AGGS: readonly CustomReportAgg[] = ["sum", "avg", "count", "min", "max"];
const VIZ = ["table", "bar", "line", "area", "pie"] as const;
const SCOPES = ["project", "portfolio", "tasks"] as const;

function isStr(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function parseMetric(v: unknown, i: number): CustomReportMetric {
  if (!v || typeof v !== "object") throw new Error(`metric ${i + 1} is not an object`);
  const m = v as Record<string, unknown>;
  if (!isStr(m["field"])) throw new Error(`metric ${i + 1} needs a "field"`);
  if (!AGGS.includes(m["agg"] as CustomReportAgg)) throw new Error(`metric ${i + 1} has an invalid "agg" (${String(m["agg"])})`);
  const metric: CustomReportMetric = { id: isStr(m["id"]) ? m["id"] : `m${i + 1}`, field: m["field"], agg: m["agg"] as CustomReportAgg };
  if (isStr(m["label"])) metric.label = m["label"];
  return metric;
}

/** Parse an optional presentation style off a definition file — only known, safe fields survive. */
function parseStyle(value: unknown): StyleSpec | undefined {
  if (!value || typeof value !== "object") return undefined;
  const s = value as Record<string, unknown>;
  const style: StyleSpec = {};
  if (isStr(s["title"])) style.title = s["title"].slice(0, 200);
  if (isStr(s["subtitle"])) style.subtitle = s["subtitle"].slice(0, 200);
  if (FONT_CHOICES.includes(s["fontFamily"] as (typeof FONT_CHOICES)[number])) style.fontFamily = s["fontFamily"] as (typeof FONT_CHOICES)[number];
  if (isStr(s["textColor"])) style.textColor = s["textColor"].slice(0, 64);
  if (isStr(s["background"])) style.background = s["background"].slice(0, 64);
  if (s["align"] === "left" || s["align"] === "center") style.align = s["align"];
  return Object.keys(style).length ? style : undefined;
}

/** Validate + normalise an unknown value into a CustomReportDef, throwing a friendly error if it isn't one. */
export function parseReportDef(value: unknown): CustomReportDef {
  if (!value || typeof value !== "object") throw new Error("not a report definition (expected a JSON object).");
  const o = value as Record<string, unknown>;
  if (!isStr(o["label"])) throw new Error('report definition needs a "label".');
  if (!SCOPES.includes(o["scope"] as (typeof SCOPES)[number])) throw new Error('report "scope" must be "project", "portfolio" or "tasks".');
  if (!VIZ.includes(o["viz"] as (typeof VIZ)[number])) throw new Error('report "viz" must be "table", "bar", "line", "area" or "pie".');
  if (!Array.isArray(o["metrics"]) || o["metrics"].length === 0) throw new Error("report needs at least one metric.");

  const def: CustomReportDef = {
    id: isStr(o["id"]) ? o["id"] : "",
    label: o["label"],
    scope: o["scope"] as CustomReportDef["scope"],
    viz: o["viz"] as CustomReportDef["viz"],
    metrics: (o["metrics"] as unknown[]).map(parseMetric),
  };
  if (isStr(o["groupBy"])) def.groupBy = o["groupBy"];
  if (isStr(o["groupBy2"])) def.groupBy2 = o["groupBy2"];
  if (isStr(o["dateField"])) def.dateField = o["dateField"];
  const chart = o["chart"];
  if (chart && typeof chart === "object") {
    const c = chart as Record<string, unknown>;
    const opts: NonNullable<CustomReportDef["chart"]> = {};
    if (typeof c["stacked"] === "boolean") opts.stacked = c["stacked"];
    if (typeof c["legend"] === "boolean") opts.legend = c["legend"];
    if (Object.keys(opts).length) def.chart = opts;
  }
  const filter = o["filter"];
  if (filter && typeof filter === "object") def.filter = filter as ConditionSet;
  const style = parseStyle(o["style"]);
  if (style) def.style = style;
  return def;
}

/** Ensure `id` is unique against `taken` (append -2, -3, … on collision); mint one from the label if blank. */
export function uniqueReportId(def: CustomReportDef, taken: readonly string[]): string {
  const base = def.id || def.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "report";
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Serialise a report definition to pretty JSON (a stable, human-diffable file). */
export function reportDefToJson(def: CustomReportDef): string {
  return JSON.stringify(def, null, 2);
}

/** Trigger a browser download of any value as pretty JSON. The one place the download idiom lives. */
export function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  triggerBlobDownload(blob, filename);
}

/** Trigger a browser download of a report definition (or a list) as a JSON file. */
export function downloadReportDef(def: CustomReportDef | CustomReportDef[], filename?: string): void {
  downloadJson(def, filename ?? (Array.isArray(def) ? "custom-reports.json" : `report-${def.id || "definition"}.json`));
}

/** Parse an uploaded file as one report def or an array of them. */
export async function readReportDefFile(file: File): Promise<CustomReportDef[]> {
  let parsed: unknown;
  try {
    parsed = safeParseJson(await file.text());
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map(parseReportDef);
}
