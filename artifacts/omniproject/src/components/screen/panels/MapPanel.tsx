import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Panel } from "../../../lib/screen";

/**
 * Map panel — geo-tagged entities on a map. config: { points: [{label,lat,lng}] }.
 *
 * Renders a real spatial plot: an equirectangular projection of the points onto an
 * SVG world grid — dependency-free and with NO external tile calls (fits the
 * no-egress ethos), plus an accessible list of places + coordinates. A tile map
 * (Leaflet/OSM) could slot in behind the same config if egress is acceptable.
 */
interface MapPoint { label: string; lat: number; lng: number }

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(4) : "—");
const projX = (lng: number) => lng + 180;
const projY = (lat: number) => 90 - lat;

export function MapPanel({ panel }: { panel: Panel }) {
  const c = panel.config ?? {};
  const points = (Array.isArray(c["points"]) ? (c["points"] as MapPoint[]) : []).filter(
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
          <svg viewBox="0 0 360 180" className="mt-2 w-full max-h-64 rounded border border-border" role="img" aria-label={`Map of ${points.length} locations`} data-testid="map-svg">
            <line x1={0} y1={90} x2={360} y2={90} stroke="currentColor" strokeWidth={0.5} className="text-muted-foreground/40" />
            <line x1={180} y1={0} x2={180} y2={180} stroke="currentColor" strokeWidth={0.5} className="text-muted-foreground/40" />
            {points.map((p, i) => (
              <g key={i}>
                <circle cx={projX(p.lng)} cy={projY(p.lat)} r={3} fill="currentColor" className="text-primary" />
                <text x={projX(p.lng) + 5} y={projY(p.lat) + 3} fontSize={7} fill="currentColor" className="text-foreground">{p.label}</text>
              </g>
            ))}
          </svg>
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
