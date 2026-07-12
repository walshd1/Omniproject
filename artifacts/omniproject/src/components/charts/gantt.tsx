import { CHART_PALETTE } from "./primitives";

/**
 * A data-agnostic Gantt primitive — one bar per item, positioned by its start/end dates on a shared
 * time axis, with an optional progress overlay. Each bar is a vector (SVG) rect that stretches to the
 * row width (`viewBox` + `preserveAspectRatio="none"`), so it scales crisply and recolours by fill;
 * row labels stay as text. Takes any `{ label, start, end, progress? }[]`.
 */
export interface GanttItem {
  label: string;
  start: string;
  end: string;
  /** 0–100 completion, drawn as a darker overlay on the bar. */
  progress?: number;
}

const ms = (d: string): number | null => {
  const t = Date.parse(d);
  return Number.isNaN(t) ? null : t;
};
const day = (t: number): string => new Date(t).toISOString().slice(0, 10);

export function GanttChart({ items, height = 18, palette = CHART_PALETTE }: { items: GanttItem[]; height?: number; palette?: string[] }) {
  const rows = items
    .map((it) => ({ it, s: ms(it.start), e: ms(it.end) }))
    .filter((r): r is { it: GanttItem; s: number; e: number } => r.s !== null && r.e !== null && r.e >= r.s);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground" data-testid="gantt-empty">No dated items to place on a timeline.</p>;
  }

  const min = Math.min(...rows.map((r) => r.s));
  const max = Math.max(...rows.map((r) => r.e));
  const span = Math.max(1, max - min);

  return (
    <div className="space-y-1" data-testid="gantt-chart">
      {/* Time axis — start · midpoint · end. */}
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
        <div className="w-36 shrink-0" />
        <div className="flex-1 flex justify-between">
          <span>{day(min)}</span>
          <span>{day(min + span / 2)}</span>
          <span>{day(max)}</span>
        </div>
      </div>
      {rows.map((r, i) => {
        const left = ((r.s - min) / span) * 100;
        const width = Math.max(1, ((r.e - r.s) / span) * 100);
        const fill = palette[i % palette.length]!;
        return (
          <div key={`${r.it.label}-${i}`} className="flex items-center gap-2">
            <div className="w-36 shrink-0 truncate text-xs" title={r.it.label}>{r.it.label}</div>
            <svg className="block flex-1" style={{ height }} viewBox="0 0 100 10" preserveAspectRatio="none">
              <rect x="0" y="0" width="100" height="10" className="fill-[hsl(var(--muted))]" fillOpacity={0.4} />
              <rect x={left} y="0" width={width} height="10" fill={fill} aria-label={`${r.it.label}: ${day(r.s)} to ${day(r.e)}`}>
                <title>{`${r.it.label}: ${day(r.s)} to ${day(r.e)}`}</title>
              </rect>
              {r.it.progress != null && (
                <rect x={left} y="0" width={(width * Math.min(100, Math.max(0, r.it.progress))) / 100} height="10" fill="#000000" fillOpacity={0.3} />
              )}
            </svg>
          </div>
        );
      })}
    </div>
  );
}
