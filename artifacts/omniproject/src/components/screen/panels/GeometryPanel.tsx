import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Panel } from "../../../lib/screen";
import { GeometryCanvas, type GeometryShape } from "../../geometry/GeometryCanvas";
import { buildGrid, type GridSpec } from "../../../lib/geometry/grid";
import { buildColumnChart, buildSparkline, type ColumnDatum } from "../../../lib/geometry/charts";

/** Expand a declarative `chart` config into geometry atoms via the atom-composed chart builders. */
function chartShapesFor(cfg: unknown, width: number, height: number): GeometryShape[] {
  if (!cfg || typeof cfg !== "object") return [];
  const c = cfg as Record<string, unknown>;
  if (c["type"] === "column" && Array.isArray(c["data"])) {
    const data = (c["data"] as unknown[])
      .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
      .map((d): ColumnDatum => ({ label: String(d["label"] ?? ""), value: typeof d["value"] === "number" ? d["value"] : Number(d["value"]) || 0 }));
    return buildColumnChart({ data, width, height, ...(typeof c["barColor"] === "string" ? { barColor: c["barColor"] } : {}) });
  }
  if (c["type"] === "sparkline" && Array.isArray(c["values"])) {
    const values = (c["values"] as unknown[]).map((v) => (typeof v === "number" ? v : Number(v))).filter((v) => Number.isFinite(v));
    return buildSparkline({ values, width, height, showPoints: c["showPoints"] === true });
  }
  return [];
}

/**
 * Geometry panel — draws a list of geometry ATOMS (line/rect/text/point) on a canvas, straight from
 * the panel's JSON config. This is how a recipe (screen/report) embeds a bespoke drawing built from
 * the fundamental primitives rather than a bespoke chart component.
 * config: { grid?: GridSpec, chart?: {type:"column"|"sparkline", …}, shapes?: GeometryShape[], width?, height? }.
 * A `grid` spec is expanded to `line` atoms via buildGrid; a `chart` is expanded to atoms via the
 * atom-composed chart builders — both drawn UNDER any explicit `shapes`, so a recipe gets graph-paper,
 * axes or a whole bar chart from one line of JSON, every mark tracing back to a fundamental atom.
 */
export function GeometryPanel({ panel }: { panel: Panel }) {
  const raw = Array.isArray(panel.config?.["shapes"]) ? (panel.config!["shapes"] as unknown[]) : [];
  const explicit = raw.filter((s): s is GeometryShape => !!s && typeof s === "object" && typeof (s as { type?: unknown }).type === "string");
  const width = typeof panel.config?.["width"] === "number" ? (panel.config!["width"] as number) : 100;
  const height = typeof panel.config?.["height"] === "number" ? (panel.config!["height"] as number) : 100;
  // A declarative grid is expanded to line atoms and drawn first (beneath the explicit shapes).
  const gridCfg = panel.config?.["grid"];
  const gridShapes = gridCfg && typeof gridCfg === "object"
    ? buildGrid({ width, height, ...(gridCfg as Partial<GridSpec>) })
    : [];
  // A declarative `chart` (column/sparkline) is expanded to atoms via the atom-composed builders.
  const chartShapes = chartShapesFor(panel.config?.["chart"], width, height);
  const shapes = [...gridShapes, ...chartShapes, ...explicit];

  return (
    <Card>
      {panel.title && (
        <CardHeader className="pb-1">
          <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">{panel.title}</CardTitle>
        </CardHeader>
      )}
      <CardContent>
        {shapes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to draw.</p>
        ) : (
          <GeometryCanvas shapes={shapes} width={width} height={height} className="w-full h-auto text-foreground" {...(panel.title ? { title: panel.title } : {})} />
        )}
      </CardContent>
    </Card>
  );
}
