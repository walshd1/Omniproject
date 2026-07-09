/**
 * Tiny, dependency-free PROPERTY-TESTING harness — the structured approach to
 * edge-case + data verification. Instead of a handful of hand-picked examples, a
 * property test asserts an INVARIANT holds over hundreds of generated inputs.
 *
 * Two properties this codebase cares about most:
 *  - SAFETY invariants ("the business ruleset can only tighten, never grant";
 *    "pmo and admin authorities are orthogonal"; "the column mapper never assigns
 *    one canonical field to two columns"). A property test is the natural home for
 *    a "for ALL inputs, X never happens" claim.
 *  - DATA verification ("every coerced value is the field's type or a passthrough
 *    string, never a silent null"; "a round-trip preserves the payload").
 *
 * Determinism is non-negotiable in CI (a flaky test is worse than no test — see
 * the session-crypto post-mortem): the generator is driven by a SEEDED PRNG, the
 * seed is fixed by default and logged, and on failure the harness reports the run
 * index, the seed, and the exact input so the case replays deterministically.
 * Set PROPTEST_SEED / PROPTEST_RUNS to explore more of the space locally.
 */

/** A deterministic PRNG returning a float in [0, 1). */
export type Rng = () => number;

/** mulberry32 — a fast, well-distributed seedable PRNG (no crypto needed here). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generator combinators — small, composable, all driven by an `Rng`. */
export const gen = {
  int: (r: Rng, min: number, max: number): number => min + Math.floor(r() * (max - min + 1)),
  bool: (r: Rng): boolean => r() < 0.5,
  pick: <T>(r: Rng, items: readonly T[]): T => items[Math.floor(r() * items.length)]!,
  /** A string from `alphabet` of length 0..maxLen. */
  string: (r: Rng, alphabet: string, maxLen: number): string => {
    const len = Math.floor(r() * (maxLen + 1));
    let s = "";
    for (let i = 0; i < len; i++) s += alphabet[Math.floor(r() * alphabet.length)];
    return s;
  },
  /** An array of 0..maxLen items from `item`. */
  array: <T>(r: Rng, item: (r: Rng) => T, maxLen: number): T[] => {
    const len = Math.floor(r() * (maxLen + 1));
    return Array.from({ length: len }, () => item(r));
  },
  /** One of the supplied generators, chosen uniformly (mix types / shapes). */
  oneOf: <T>(r: Rng, ...gens: Array<(r: Rng) => T>): T => gens[Math.floor(r() * gens.length)]!(r),
};

export interface PropOpts {
  /** How many generated cases to run (default 200, or PROPTEST_RUNS). */
  runs?: number;
  /** PRNG seed (default a fixed constant, or PROPTEST_SEED) — keeps CI deterministic. */
  seed?: number;
}

function resolveSeed(opts: PropOpts): number {
  if (opts.seed !== undefined) return opts.seed >>> 0;
  const env = Number(process.env["PROPTEST_SEED"]);
  return Number.isFinite(env) && env !== 0 ? env >>> 0 : 0x9e3779b9;
}

/**
 * Assert `prop` holds for `runs` generated inputs. On the first failure, rethrow
 * with the run index, seed and input attached so the case is reproducible
 * (re-run with PROPTEST_SEED=<seed>). Returns the seed used (handy for logging).
 */
export function check<T>(generate: (r: Rng) => T, prop: (value: T) => void, opts: PropOpts = {}): number {
  const seed = resolveSeed(opts);
  const runs = opts.runs ?? (Number(process.env["PROPTEST_RUNS"]) || 200);
  const rng = mulberry32(seed);
  for (let i = 0; i < runs; i++) {
    const value = generate(rng);
    try {
      prop(value);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      let input: string;
      try {
        input = JSON.stringify(value);
      } catch {
        input = String(value);
      }
      err.message = `property failed on run ${i + 1}/${runs} (seed=${seed}); replay with PROPTEST_SEED=${seed}\n  input: ${input}\n  ${err.message}`;
      throw err;
    }
  }
  return seed;
}
