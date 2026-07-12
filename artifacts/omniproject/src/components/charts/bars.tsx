/**
 * Vector (SVG) bar primitives — small, data-agnostic marks used inline in report rows. Being SVG they
 * scale to any size crisply (a `viewBox` + `preserveAspectRatio="none"` stretched to the given
 * width/height) and recolour via `fill-current` driven by a Tailwind text-colour class, so they stay
 * theme-aware. Status colours here are RESERVED (good / warning / critical), used for genuine state.
 *  - AllocationBar: a bullet bar — value against a track, a target marker, threshold status colour.
 *  - ProportionBar: a segmented share bar — parts of a whole, each a coloured segment.
 */

/** Default over/optimal/under colouring for a utilisation/allocation percentage. Returns a Tailwind
 *  text-colour class; the SVG fills it via `fill-current`. */
export function allocationTone(pct: number | null): string {
  if (pct === null) return "text-zinc-400";
  if (pct > 100) return "text-red-500";
  if (pct >= 80) return "text-green-500";
  return "text-zinc-500";
}

/**
 * A bullet bar: `value` fills a 0–`max` track (clamped), a thin marker sits at `target`, and the fill
 * colour comes from `tone(value)` (a text-colour class). Vector + resizable — set `width`/`height`
 * (CSS sizes); the geometry stretches to fit. `null` value renders an empty track.
 */
export function AllocationBar({ value, max = 150, target = 100, tone = allocationTone, className = "", width = "100%", height = 8 }: {
  value: number | null;
  max?: number;
  target?: number;
  tone?: (v: number | null) => string;
  className?: string;
  width?: number | string;
  height?: number | string;
}) {
  const fill = value === null ? 0 : (Math.min(value, max) / max) * 100;
  const markerX = target > 0 && target <= max ? (target / max) * 100 : null;
  return (
    <svg role="img" className={`block ${className}`} style={{ width, height }} viewBox="0 0 100 10" preserveAspectRatio="none">
      <rect x="0" y="0" width="100" height="10" className="fill-[hsl(var(--muted))]" />
      {fill > 0 && <rect x="0" y="0" width={fill} height="10" className={`fill-current ${tone(value)}`} />}
      {markerX !== null && <line x1={markerX} y1="0" x2={markerX} y2="10" className="stroke-[hsl(var(--foreground))]" strokeOpacity={0.6} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/** One segment of a proportion bar: a share `value` and a fill colour (a Tailwind text-colour class,
 *  filled via `fill-current`). */
export interface ProportionSegment {
  key: string;
  value: number;
  /** A Tailwind text-colour class (typically a reserved status colour), e.g. "text-red-500". */
  className: string;
  title?: string;
}
/**
 * A segmented share bar — parts of a whole laid out left→right, each segment's width ∝ its value.
 * Zero-value segments are dropped. Vector + resizable. `testIdPrefix` tags each segment for tests.
 */
export function ProportionBar({ segments, height = 10, className = "", testId, testIdPrefix }: {
  segments: ProportionSegment[];
  height?: number | string;
  className?: string;
  testId?: string;
  testIdPrefix?: string;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total === 0) return null;
  let x = 0;
  return (
    <svg role="img" className={`block w-full ${className}`} style={{ height }} viewBox="0 0 100 10" preserveAspectRatio="none" {...(testId ? { "data-testid": testId } : {})}>
      <rect x="0" y="0" width="100" height="10" className="fill-[hsl(var(--muted))]" />
      {segments.map((s) => {
        if (s.value <= 0) return null;
        const w = (s.value / total) * 100;
        const rx = x;
        x += w;
        return (
          <rect key={s.key} {...(testIdPrefix ? { "data-testid": `${testIdPrefix}-${s.key}` } : {})} x={rx} y="0" width={w} height="10" className={`fill-current ${s.className}`}>
            <title>{s.title ?? `${s.value} ${s.key}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
