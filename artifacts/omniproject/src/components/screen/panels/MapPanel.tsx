import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Panel } from "../../../lib/screen";

/**
 * Map panel — geo-tagged entities on a map. config: { points: [{label,lat,lng}] }.
 *
 * This ships the ACCESSIBLE summary (count + a readable list of places with their
 * coordinates) so the panel is JSON-composable today; the rich tile-map (Leaflet)
 * rendering is the remaining work and slots in behind this same component + config.
 */
interface MapPoint { label: string; lat: number; lng: number }

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : "—");

export function MapPanel({ panel }: { panel: Panel }) {
  const c = panel.config ?? {};
  const points = Array.isArray(c["points"]) ? (c["points"] as MapPoint[]) : [];
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
          <ul className="mt-2 space-y-1 text-sm" aria-label="Map locations">
            {points.map((p, i) => (
              <li key={i}>
                {p.label} <span className="text-muted-foreground tabular-nums">({fmt(p.lat)}, {fmt(p.lng)})</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Visual tile-map rendering is coming; this is the accessible data view.</p>
      </CardContent>
    </Card>
  );
}
