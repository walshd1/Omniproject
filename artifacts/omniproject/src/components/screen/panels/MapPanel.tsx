import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Panel } from "../../../lib/screen";
import { GeoPlot, type GeoPoint } from "../../charts/GeoPlot";

/**
 * Map panel — geo-tagged entities on a map. config: { points: [{label,lat,lng}] }.
 *
 * Renders a real spatial plot through the shared GeoPlot primitive: an equirectangular
 * projection of the points onto an SVG world grid — dependency-free and with NO external
 * tile calls (fits the no-egress ethos), plus an accessible list of places + coordinates.
 * A tile map (Leaflet/OSM) could slot in behind the same config if egress is acceptable.
 */
const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : "—");

export function MapPanel({ panel }: { panel: Panel }) {
  const c = panel.config ?? {};
  const points = (Array.isArray(c["points"]) ? (c["points"] as GeoPoint[]) : []).filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng),
  );
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">{panel.title ?? "Map"}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-muted-foreground" role="status">
          {points.length} location{points.length === 1 ? "" : "s"}
        </div>
        {points.length > 0 && (
          <GeoPlot
            testId="map-svg"
            className="mt-2 w-full max-h-64 rounded border border-border"
            ariaLabel={`Map of ${points.length} locations`}
            points={points}
          />
        )}
        {points.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm sr-only" aria-label="Map locations">
            {points.map((p, i) => (
              <li key={i}>{p.label} ({fmt(p.lat)}, {fmt(p.lng)})</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
