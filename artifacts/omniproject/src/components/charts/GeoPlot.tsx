/**
 * A data-agnostic geographic scatter primitive — plots `{ label, lat, lng }[]` onto an equirectangular
 * SVG world grid (equator + prime-meridian guides), dependency-free and with NO external tile calls, so
 * it renders under the strict CSP with no map library. Vector `<svg>` that scales to its container. The
 * shared substrate for the map surfaces the screen panels drew inline. Invalid coordinates are dropped.
 */
export interface GeoPoint {
  label: string;
  lat: number;
  lng: number;
}

const projX = (lng: number) => lng + 180;
const projY = (lat: number) => 90 - lat;

export function GeoPlot({ points, ariaLabel, testId, className = "w-full max-h-64 rounded border border-border" }: {
  points: GeoPoint[];
  ariaLabel: string;
  testId?: string;
  className?: string;
}) {
  const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  return (
    <svg viewBox="0 0 360 180" className={className} role="img" aria-label={ariaLabel} {...(testId ? { "data-testid": testId } : {})}>
      <line x1={0} y1={90} x2={360} y2={90} stroke="currentColor" strokeWidth={0.5} className="text-muted-foreground/40" />
      <line x1={180} y1={0} x2={180} y2={180} stroke="currentColor" strokeWidth={0.5} className="text-muted-foreground/40" />
      {valid.map((p, i) => (
        <g key={i}>
          <circle cx={projX(p.lng)} cy={projY(p.lat)} r={3} fill="currentColor" className="text-primary" />
          <text x={projX(p.lng) + 5} y={projY(p.lat) + 3} fontSize={7} fill="currentColor" className="text-foreground">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}
