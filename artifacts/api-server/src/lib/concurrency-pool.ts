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
