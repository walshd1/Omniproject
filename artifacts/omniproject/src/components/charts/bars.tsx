/**
 * Non-Recharts bar primitives — small, div-based data marks used inline in report rows (a whole
 * Recharts chart would be overkill for one row). Data-agnostic like the ChartView primitives:
 *  - AllocationBar: a bullet bar — value against a track, a target marker, threshold status colour.
 *  - ProportionBar: a segmented share bar — parts of a whole, each a coloured segment.
 * Status colours here are RESERVED (good / warning / critical), used for genuine state, never as a
 * categorical series colour.
 */

/** Default over/optimal/under colouring for a utilisation/allocation percentage. */
export function allocationTone(pct: number | null): string {
  if (pct === null) return "bg-zinc-400";
  if (pct > 100) return "bg-red-500";
  if (pct >= 80) return "bg-green-500";
  return "bg-zinc-500";
}

/**
 * A bullet bar: `value` fills a 0–`max` track (clamped), a thin marker sits at `target`, and the
 * fill colour comes from `tone(value)`. `null` value renders an empty track. The caller sizes the
 * track width via `className` (e.g. "w-28"); default is full width.
 */
export function AllocationBar({ value, max = 150, target = 100, tone = allocationTone, className = "" }: {
  value: number | null;
  max?: number;
  target?: number;
  tone?: (v: number | null) => string;
  className?: string;
}) {
  const width = value === null ? 0 : (Math.min(value, max) / max) * 100;
  return (
    <div className={`h-2 bg-muted relative overflow-hidden ${className}`}>
      <div className={`h-full ${tone(value)}`} style={{ width: `${width}%` }} />
      {target > 0 && target <= max && (
        <div className="absolute top-0 bottom-0 w-px bg-foreground/60" style={{ left: `${(target / max) * 100}%` }} />
      )}
    </div>
  );
}

/** One segment of a proportion bar: a share `value` and a fill colour class. */
export interface ProportionSegment {
  key: string;
  value: number;
  /** A tailwind background class (typically a reserved status colour). */
  className: string;
  title?: string;
}
/**
 * A segmented share bar — parts of a whole laid out left→right, each segment's width ∝ its value.
 * Zero-value segments are dropped. `testIdPrefix` tags each segment for tests.
 */
export function ProportionBar({ segments, height = "h-2", testIdPrefix, className = "", testId }: {
  segments: ProportionSegment[];
  height?: string;
  testIdPrefix?: string;
  className?: string;
  testId?: string;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total === 0) return null;
  return (
    <div className={`flex w-full ${height} overflow-hidden bg-muted ${className}`} {...(testId ? { "data-testid": testId } : {})}>
      {total > 0 && segments.map((s) => (s.value > 0 ? (
        <div
          key={s.key}
          {...(testIdPrefix ? { "data-testid": `${testIdPrefix}-${s.key}` } : {})}
          className={s.className}
          style={{ width: `${(s.value / total) * 100}%` }}
          title={s.title ?? `${s.value} ${s.key}`}
        />
      ) : null))}
    </div>
  );
}
