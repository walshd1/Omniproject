import { useMemo } from "react";
import type { TrendSeries } from "../../lib/trends";

/**
 * A small, dependency-free trend line for a `TrendSeries` — inline SVG so it works in the strict CSP
 * with no chart library. Null points (real gaps, where no data was retained yet) break the line
 * rather than being drawn as zero. When the series is unavailable it renders an honest note instead
 * of an empty axis, so "history not yet retained" reads clearly.
 */
export function TrendChart({ series, label, unit = "", height = 64 }: {
  series: TrendSeries | undefined;
  label: string;
  unit?: string;
  height?: number;
}) {
  const geom = useMemo(() => {
    if (!series || !series.available) return null;
    const pts = series.points;
    const vals = pts.map((p) => p.value).filter((v): v is number => v !== null);
    if (vals.length === 0) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const w = 100; // viewBox width (percent-like units); SVG scales to container
    const stepX = pts.length > 1 ? w / (pts.length - 1) : 0;
    const y = (v: number) => height - 4 - ((v - min) / span) * (height - 8);
    // Build path segments, breaking on nulls.
    let d = "";
    pts.forEach((p, i) => {
      if (p.value === null) { d += " "; return; }
      const cmd = d.trim().endsWith("") && (i === 0 || pts[i - 1]!.value === null) ? "M" : "L";
      d += `${cmd}${(i * stepX).toFixed(2)},${y(p.value).toFixed(2)} `;
    });
    const last = [...vals].pop()!;
    const firstVal = vals[0]!;
    return { d: d.trim(), min, max, last, delta: last - firstVal, w };
  }, [series, height]);

  if (!series) return null;

  if (!series.available || !geom) {
    return (
      <div className="border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground" data-testid="trend-unavailable">
        <span className="font-bold">{label}:</span>{" "}
        {series.available ? "no data retained for this window yet." : `history not yet retained — ${series.reason ?? "no retention source"}.`}
      </div>
    );
  }

  const up = geom.delta >= 0;
  return (
    <figure className="space-y-1" data-testid="trend-chart">
      <figcaption className="flex items-baseline justify-between text-xs">
        <span className="font-bold">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          latest {round(geom.last)}{unit}{" "}
          <span className={up ? "text-green-600" : "text-red-500"}>({up ? "▲" : "▼"} {round(Math.abs(geom.delta))}{unit})</span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${geom.w} ${height}`} preserveAspectRatio="none" role="img"
        aria-label={`${label} trend, latest ${round(geom.last)}${unit}`} className="w-full" style={{ height }}>
        <path d={geom.d} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
          className={up ? "text-green-600" : "text-red-500"} />
      </svg>
    </figure>
  );
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
