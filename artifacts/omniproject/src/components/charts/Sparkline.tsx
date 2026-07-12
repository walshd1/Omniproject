import { useMemo } from "react";

/**
 * A data-agnostic sparkline primitive — a small trend line for a `(number | null)[]` series, drawn as
 * dependency-free inline SVG so it renders under the strict CSP with no chart library. Null points are
 * real gaps: the line breaks across them rather than being drawn as zero. It scales to its container
 * (vector) and reads out the latest value with a ▲/▼ delta from the first point. Returns null when the
 * series holds no numeric points — callers render their own "no data" state around it.
 */
export function Sparkline({ points, label, unit = "", height = 64, testId = "sparkline" }: {
  points: (number | null)[];
  label: string;
  unit?: string;
  height?: number;
  testId?: string;
}) {
  const geom = useMemo(() => {
    const vals = points.filter((v): v is number => v !== null);
    if (vals.length === 0) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const w = 100; // viewBox width (percent-like units); SVG scales to container
    const stepX = points.length > 1 ? w / (points.length - 1) : 0;
    const y = (v: number) => height - 4 - ((v - min) / span) * (height - 8);
    // Build path segments, breaking on nulls.
    let d = "";
    points.forEach((v, i) => {
      if (v === null) { d += " "; return; }
      const cmd = i === 0 || points[i - 1] === null ? "M" : "L";
      d += `${cmd}${(i * stepX).toFixed(2)},${y(v).toFixed(2)} `;
    });
    const last = vals[vals.length - 1]!;
    const firstVal = vals[0]!;
    return { d: d.trim(), min, max, last, delta: last - firstVal, w };
  }, [points, height]);

  if (!geom) return null;

  const up = geom.delta >= 0;
  return (
    <figure className="space-y-1" data-testid={testId}>
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
