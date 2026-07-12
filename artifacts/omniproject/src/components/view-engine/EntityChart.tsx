import { useMemo } from "react";
import type { EntityField, ViewRecord } from "../../lib/view-engine/types";
import type { ViewChartSpec } from "../../lib/view-engine/view-defs";
import { SeriesBarChart, SharePieChart, TreemapChart } from "../charts/primitives";
import { GanttChart, type GanttItem } from "../charts/gantt";

/**
 * Renders an entity's records as a chart, per a `ViewChartSpec` — the bridge between the view engine
 * and the data-agnostic chart primitives. Count/share charts group records by a field and count them;
 * a gantt spans each record between two date fields. Works for tasks and issues alike.
 */
export function EntityChart<T>({ records, fields, spec, noun }: {
  records: ViewRecord<T>[];
  fields: EntityField<T>[];
  spec: ViewChartSpec;
  noun: string;
}) {
  const fm = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f])), [fields]);

  const counts = useMemo(() => {
    const field = fm[spec.groupField ?? "status"];
    const m = new Map<string, number>();
    for (const r of records) {
      const k = (field?.get(r.raw) ?? "") || "—";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()];
  }, [records, fm, spec.groupField]);

  if (spec.type === "gantt") {
    const sf = fm[spec.startField ?? ""];
    const ef = fm[spec.endField ?? ""];
    const items: GanttItem[] = records.map((r) => ({ label: r.title, start: sf?.get(r.raw) ?? "", end: ef?.get(r.raw) ?? "" }));
    return <GanttChart items={items} />;
  }
  if (spec.type === "pie" || spec.type === "donut") {
    return <SharePieChart data={counts.map(([name, value]) => ({ name, value }))} donut={spec.type === "donut"} />;
  }
  if (spec.type === "wbs") {
    return <TreemapChart data={counts.map(([name, value]) => ({ name, value }))} />;
  }
  // bar — count of records per group
  return <SeriesBarChart data={counts.map(([name, value]) => ({ name, count: value }))} series={[{ key: "count", label: `${noun}s` }]} legend={false} />;
}
