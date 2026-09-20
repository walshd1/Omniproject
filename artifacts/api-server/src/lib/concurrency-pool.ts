/**
 * Tiny bounded-concurrency pool — the `p-limit` pattern without adding a dependency.
 * Every portfolio-wide fan-out (export, OData feed, resource roster, broker verify probes) was
 * firing one request per project/probe with a bare `Promise.all`, which is fine at demo scale but
 * becomes a 200-way thundering herd at the 60/200 target (saturates the backend, trips 429s). This
 * caps how many `fn` calls are in flight at once while still resolving every item, in input order,
 * exactly like `Promise.all(items.map(fn))` — a drop-in replacement at every call site.
 *
 * See docs/PERF-PATTERNS-REVIEW.md, Theme A.
 */

/** A bounded limiter: call `run(fn)` any number of times; at most `limit` wrapped calls run at once. */
export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

/** A limiter: call `run(fn)` any number of times; at most `limit` of the wrapped calls are ever
 *  in flight concurrently. Ordering of when each call STARTS is FIFO; each returned promise
 *  settles independently once its own `fn` resolves/rejects. */
export function createConcurrencyLimiter(limit: number): Limiter {
  const boundedLimit = Math.max(1, limit);
  let active = 0;
  const queue: Array<() => void> = [];

  function schedule(): void {
    if (active >= boundedLimit) return;
    const next = queue.shift();
    if (!next) return;
    active++;
    next();
  }

  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active--;
          schedule();
        });
      });
      schedule();
    });
  };
}

/**
 * Fan `items` out through an EXISTING limiter — the generic bounded fan-out. Resolves in input order
 * (same contract as `Promise.all`). Use this (rather than {@link poolMap}) to SHARE one limiter across
 * several fan-outs, so their COMBINED concurrency is bounded instead of each pool being capped alone.
 */
export function poolMapWith<T, R>(run: Limiter, items: readonly T[], fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  return Promise.all(items.map((item, index) => run(() => fn(item, index))));
}

/**
 * Map `items` through the async `fn`, keeping at most `limit` calls in flight at once (its own fresh
 * limiter). Resolves in input order, so callers can swap `Promise.all(items.map(fn))` for
 * `poolMap(items, limit, fn)` with no other change.
 */
export function poolMap<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  return poolMapWith(createConcurrencyLimiter(limit), items, fn);
}

/** One item's outcome from a settling fan-out: the value, or the item and why it failed. */
export type Settled<T, R> =
  | { ok: true; item: T; index: number; value: R }
  | { ok: false; item: T; index: number; error: unknown };

/**
 * Like {@link poolMapWith}, but SETTLING: it never rejects. Every item's outcome comes back in input
 * order, so a caller can serve the slice that answered instead of losing the whole response to one
 * failure.
 *
 * This is the degraded-read primitive. `poolMap` is built on `Promise.all`, so a portfolio fan-out
 * across 200 projects loses all 200 when one backend times out — the other systems were answering
 * fine. Use this where a partial answer is genuinely useful, then gate any CROSS-SOURCE aggregate on
 * `readsWereComplete()` (see lib/read-availability.ts): the rows that answered are real, but a total
 * summed over a subset is wrong, not merely smaller.
 *
 * Prefer `poolMap` when partial output would be meaningless or unsafe (a bulk WRITE, a config export
 * that must be whole). Failing loud is the right behaviour there and stays the default.
 */
export function poolSettleWith<T, R>(
  run: Limiter,
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<Settled<T, R>>> {
  return Promise.all(
    items.map((item, index) =>
      run(() => fn(item, index)).then(
        (value): Settled<T, R> => ({ ok: true, item, index, value }),
        (error: unknown): Settled<T, R> => ({ ok: false, item, index, error }),
      ),
    ),
  );
}

/** {@link poolSettleWith} with its own fresh limiter — the drop-in settling counterpart to `poolMap`. */
export function poolSettle<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<Settled<T, R>>> {
  return poolSettleWith(createConcurrencyLimiter(limit), items, fn);
}

/** The values that succeeded, in input order — the common case after {@link poolSettle}. */
export function settledValues<T, R>(settled: ReadonlyArray<Settled<T, R>>): R[] {
  return settled.filter((s): s is Extract<Settled<T, R>, { ok: true }> => s.ok).map((s) => s.value);
}
