import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Panel } from "../../../lib/screen";
import { GeometryCanvas, type GeometryShape } from "../../geometry/GeometryCanvas";

/**
 * Geometry panel — draws a list of geometry ATOMS (line/rect/text/point) on a canvas, straight from
 * the panel's JSON config. This is how a recipe (screen/report) embeds a bespoke drawing built from
 * the fundamental primitives rather than a bespoke chart component.
 * config: { shapes: GeometryShape[], width?, height? }.
 */
export function GeometryPanel({ panel }: { panel: Panel }) {
  const raw = Array.isArray(panel.config?.["shapes"]) ? (panel.config!["shapes"] as unknown[]) : [];
  const shapes = raw.filter((s): s is GeometryShape => !!s && typeof s === "object" && typeof (s as { type?: unknown }).type === "string");
  const width = typeof panel.config?.["width"] === "number" ? (panel.config!["width"] as number) : 100;
  const height = typeof panel.config?.["height"] === "number" ? (panel.config!["height"] as number) : 100;

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
