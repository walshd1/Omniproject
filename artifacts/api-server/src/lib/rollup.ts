/**
 * GENERIC roll-up — the one, artifact-agnostic aggregation over rows. Any list of flat rows can be grouped
 * by any field and aggregated by any metric (sum / avg / count / min / max), so a report is just a JSON spec
 * `{ groupBy, metrics }` over a row source — "man-hours by programme", "booked hours by resource", "budget
 * by year" are all the same call with different fields. No bespoke per-feature roll-up, and no rendering
 * here: it emits generic rows any artifact (a JSON report def on the no-code engine, a chart primitive, an
 * export) draws on the fly. Mirrors the SPA custom-report engine's spec so backend + frontend agree.
 */

export type Agg = "sum" | "avg" | "count" | "min" | "max";

export interface Metric {
  /** Row field to aggregate (ignored for `count`). */
  field: string;
  agg: Agg;
  /** Output column name; defaults to `field` (or "count"). */
  as?: string;
}

export interface RollupSpec {
  /** Field whose distinct values become the groups (the roll-up dimension). */
  groupBy: string;
  /** Optional second dimension → a pivot: one output column per (groupBy2 value × metric). */
  groupBy2?: string;
  metrics: Metric[];
}

type Row = Record<string, unknown>;

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const key = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));
const metricName = (m: Metric): string => m.as ?? (m.agg === "count" ? "count" : m.field);

function aggregate(agg: Agg, values: number[], rowCount: number): number {
  if (agg === "count") return rowCount;
  if (values.length === 0) return 0;
  if (agg === "sum") return values.reduce((s, n) => s + n, 0);
  if (agg === "avg") return Math.round((values.reduce((s, n) => s + n, 0) / values.length) * 1e6) / 1e6;
  if (agg === "min") return Math.min(...values);
  return Math.max(...values);
}

/**
 * Roll `rows` up per the spec into generic output rows: one per distinct `groupBy` value, carrying that
 * value under the `groupBy` field plus each metric's aggregate (and a `count`). With `groupBy2`, each metric
 * is spread across the distinct `groupBy2` values (a pivot: column name = `<groupBy2value> · <metric>`).
 * Groups come out sorted by the first metric descending (stable, deterministic). Pure.
 */
export function rollup(rows: readonly Row[], spec: RollupSpec): Array<Record<string, unknown>> {
  const metrics = spec.metrics.length ? spec.metrics : [{ field: "", agg: "count" as Agg }];
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const g = key(r[spec.groupBy]);
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(r);
  }

  const cols2 = spec.groupBy2
    ? [...new Set(rows.map((r) => key(r[spec.groupBy2!])))].sort()
    : null;

  const out: Array<Record<string, unknown>> = [];
  for (const [g, grp] of groups) {
    const row: Record<string, unknown> = { [spec.groupBy]: g, count: grp.length };
    if (cols2) {
      const m = metrics[0]!;
      for (const c of cols2) {
        const cell = grp.filter((r) => key(r[spec.groupBy2!]) === c);
        row[`${c} · ${metricName(m)}`] = aggregate(m.agg, cell.map((r) => num(r[m.field])), cell.length);
      }
    } else {
      for (const m of metrics) row[metricName(m)] = aggregate(m.agg, grp.map((r) => num(r[m.field])), grp.length);
    }
    out.push(row);
  }
  const sortKey = cols2 ? "count" : metricName(metrics[0]!);
  return out.sort((a, b) => num(b[sortKey]) - num(a[sortKey]));
}

/** Parse a compact query spec — `groupBy=programme&metric=sum:hours,avg:cost` — into a {@link RollupSpec}, or
 *  null when no `groupBy` is given (caller returns the raw rows). Artifact/source-agnostic. */
export function parseRollupQuery(q: Record<string, unknown>): RollupSpec | null {
  const groupBy = typeof q["groupBy"] === "string" ? (q["groupBy"] as string).trim() : "";
  if (!groupBy) return null;
  const metricRaw = typeof q["metric"] === "string" ? (q["metric"] as string) : "";
  const metrics: Metric[] = metricRaw.split(",").map((s) => s.trim()).filter(Boolean).map((tok) => {
    const [agg, field] = tok.split(":");
    const a = (["sum", "avg", "count", "min", "max"] as const).find((x) => x === agg) ?? "count";
    return { agg: a, field: (field ?? "").trim() };
  });
  return { groupBy, ...(typeof q["groupBy2"] === "string" && q["groupBy2"] ? { groupBy2: (q["groupBy2"] as string).trim() } : {}), metrics: metrics.length ? metrics : [{ field: "", agg: "count" }] };
}
