import { type ControlsConfig, type ControlsState, groupByOptions, distinctValues } from "../../lib/panel-controls";

/**
 * The optional per-panel control bar: a period/group selector, a metric aggregation, and a value filter per
 * configured field. Purely presentational — it renders the current {@link ControlsState} and reports changes
 * up; the panel owns the state and applies it via applyControls. Shown only when a panel declares `controls`.
 */
const AGG_LABEL: Record<string, string> = { sum: "Sum", avg: "Average", count: "Count", min: "Min", max: "Max" };

export function PanelControls({ config, rows, state, onChange }: {
  config: ControlsConfig;
  rows: readonly Record<string, unknown>[];
  state: ControlsState;
  onChange: (next: ControlsState) => void;
}) {
  const groups = groupByOptions(config);
  const aggs = config.aggs ?? ["sum", "avg", "count", "min", "max"];
  const filters = config.filters ?? [];

  const setFilter = (field: string, value: string) =>
    onChange({ ...state, filters: { ...state.filters, [field]: value ? [value] : [] } });

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs" data-testid="panel-controls">
      {groups.length > 0 && (
        <label className="flex items-center gap-1 text-muted-foreground">
          Group
          <select aria-label="Group by" data-testid="control-groupby" value={state.groupBy} onChange={(e) => onChange({ ...state, groupBy: e.target.value })} className="h-7 border border-foreground bg-background px-1 font-bold">
            {groups.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </label>
      )}
      {config.metricField !== undefined && (
        <label className="flex items-center gap-1 text-muted-foreground">
          Metric
          <select aria-label="Aggregation" data-testid="control-agg" value={state.agg} onChange={(e) => onChange({ ...state, agg: e.target.value as ControlsState["agg"] })} className="h-7 border border-foreground bg-background px-1 font-bold">
            {aggs.map((a) => <option key={a} value={a}>{AGG_LABEL[a] ?? a}</option>)}
          </select>
        </label>
      )}
      {filters.map((field) => (
        <label key={field} className="flex items-center gap-1 text-muted-foreground">
          {field}
          <select aria-label={`Filter ${field}`} data-testid={`control-filter-${field}`} value={state.filters[field]?.[0] ?? ""} onChange={(e) => setFilter(field, e.target.value)} className="h-7 border border-foreground bg-background px-1">
            <option value="">All</option>
            {distinctValues(rows, field).map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}
