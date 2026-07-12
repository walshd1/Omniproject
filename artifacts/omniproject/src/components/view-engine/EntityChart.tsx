import { useMemo } from "react";
import type { EntityField, ViewRecord } from "../../lib/view-engine/types";
import type { ViewChartSpec } from "../../lib/view-engine/view-defs";
import type { StyleSpec } from "../../lib/artifact-style";
import { ChartView } from "../charts/ChartView";
import type { GanttItem } from "../charts/gantt";

/**
 * Renders an entity's records as a chart, per a `ViewChartSpec` — the bridge between the view engine
 * and the common {@link ChartView} renderer. Count/share charts group records by a field and count
 * them; a gantt spans each record between two date fields. Works for tasks and issues alike; the
 * actual drawing is delegated to ChartView (data over the shared primitives).
 */
export function EntityChart<T>({ records, fields, spec, noun, style }: {
  records: ViewRecord<T>[];
  fields: EntityField<T>[];
  spec: ViewChartSpec;
  noun: string;
  style?: StyleSpec;
}) {
  const fm = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f])), [fields]);
  const styleProp = style ? { style } : {};

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
    return <ChartView type="gantt" items={items} {...styleProp} />;
  }
  if (spec.type === "pie" || spec.type === "donut") {
    return <ChartView type={spec.type} data={counts.map(([name, value]) => ({ name, value }))} {...styleProp} />;
  }
  if (spec.type === "wbs") {
    return <ChartView type="treemap" data={counts.map(([name, value]) => ({ name, value }))} {...styleProp} />;
  }
  return <ChartView type="bar" data={counts.map(([name, value]) => ({ name, count: value }))} series={[{ key: "count", label: `${noun}s` }]} legend={false} {...styleProp} />;
}
