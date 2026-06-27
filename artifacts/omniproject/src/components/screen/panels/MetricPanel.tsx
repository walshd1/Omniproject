import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Panel } from "../../../lib/screen";

/**
 * Metric panel — a single headline number (KPI). config: { value, unit?, hint? }.
 */
export function MetricPanel({ panel }: { panel: Panel }) {
  const c = panel.config ?? {};
  const value = c["value"];
  const unit = typeof c["unit"] === "string" ? c["unit"] : "";
  const hint = typeof c["hint"] === "string" ? c["hint"] : undefined;
  return (
    <Card>
      {panel.title && (
        <CardHeader className="pb-1">
          <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">{panel.title}</CardTitle>
        </CardHeader>
      )}
      <CardContent>
        <div className="text-3xl font-bold tabular-nums">
          {String(value ?? "—")}
          {unit && <span className="ml-1 text-base font-normal text-muted-foreground">{unit}</span>}
        </div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
