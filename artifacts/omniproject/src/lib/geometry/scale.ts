/**
 * Scale + ticks — the small numeric foundation that lets a data chart compose from geometry atoms.
 * A chart is "data mapped to coordinates, drawn as shapes": `linearScale` does the mapping (domain →
 * canvas range) and `niceTicks` picks human-round gridline values. Pure maths, no SVG — the chart
 * builders turn the results into `line`/`rect`/`text`/`point` atoms.
 */

/**
 * A linear scale mapping a numeric `domain` onto a `range` (both `[from, to]`). Range `to` may be less
 * than `from` (SVG y grows downward, so a value axis maps [min,max] → [height, 0]). A zero-width domain
 * maps everything to the range start (avoids divide-by-zero).
 */
export function linearScale(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  return (v) => (span === 0 ? r0 : r0 + ((v - d0) / span) * (r1 - r0));
}

/** Round `x` to a "nice" number (1/2/5/10 × 10ⁿ); `up` rounds the step size, else rounds to nearest. */
function niceNum(x: number, up: boolean): number {
  if (x <= 0 || !Number.isFinite(x)) return 0;
  const exp = Math.floor(Math.log10(x));
  const frac = x / 10 ** exp;
  let nice: number;
  if (up) nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  else nice = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  return nice * 10 ** exp;
}

/**
 * "Nice" tick values covering `[min, max]` in roughly `count` steps, each a human-round number
 * (…, 0, 25, 50, …). Returns the ticks ascending, inclusive of the nice bounds. Degenerate inputs
 * (min===max, non-finite) yield a single tick so callers never divide by an empty axis.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (min === max) return [min];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const step = niceNum((hi - lo) / Math.max(1, count), true) || 1;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  // Guard the loop count in case of pathological step (belt-and-braces; step is nice+positive above).
  for (let v = start, i = 0; v <= end + step / 2 && i < 1000; v += step, i++) {
    // Snap away tiny floating-point residue so ticks read as clean numbers.
    ticks.push(Math.round(v / step) * step);
  }
  return ticks;
}
