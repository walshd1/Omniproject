import type { TrendSeries } from "../../lib/trends";
import { Sparkline } from "../charts/Sparkline";

/**
 * TrendChart — the domain adapter that renders a retained `TrendSeries` through the shared Sparkline
 * primitive. It owns the honest "history not yet retained / no data" messaging (retention is a domain
 * concern the primitive knows nothing about); when there is real numeric history it hands the values to
 * Sparkline, which draws the dependency-free vector line and the latest-value delta.
 */
export function TrendChart({ series, label, unit = "", height = 64 }: {
  series: TrendSeries | undefined;
  label: string;
  unit?: string;
  height?: number;
}) {
  if (!series) return null;

  const values = series.points.map((p) => p.value);
  const hasNumeric = values.some((v) => v !== null);

  if (!series.available || !hasNumeric) {
    return (
      <div className="border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground" data-testid="trend-unavailable">
        <span className="font-bold">{label}:</span>{" "}
        {series.available ? "no data retained for this window yet." : `history not yet retained — ${series.reason ?? "no retention source"}.`}
      </div>
    );
  }

  return <Sparkline points={values} label={label} unit={unit} height={height} testId="trend-chart" />;
}
