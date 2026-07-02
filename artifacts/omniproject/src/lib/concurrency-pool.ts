/**
 * Tiny bounded-concurrency pool — the `p-limit` pattern without adding a dependency. Several
 * portfolio-wide fan-outs (My Work, Global Search, the explore-replica capture, predictive
 * prefetch) fire one request PER PROJECT — fine at demo scale, but a 200-way thundering herd at
 * the 60/200-project target that saturates the browser's ~6-connection-per-origin limit. This
 * caps how many wrapped calls are actually in flight at once, while every caller still gets its
 * own result (nothing is dropped or starved indefinitely — every queued call eventually runs).
 *
 * See docs/PERF-PATTERNS-REVIEW.md, Theme A.
 */

/** A limiter: call `run(fn)` any number of times (from anywhere — a `useQueries` `queryFn`, a
 *  loop, …); at most `limit` of the wrapped calls are ever in flight concurrently. */
export function createConcurrencyLimiter(limit: number): <T>(fn: () => Promise<T>) => Promise<T> {
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
 * Map `items` through the async `fn`, keeping at most `limit` calls in flight at once. Resolves in
 * input order (same contract as `Promise.all`), so callers can swap `Promise.all(items.map(fn))`
 * for `poolMap(items, limit, fn)` with no other change.
 */
export function poolMap<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const run = createConcurrencyLimiter(limit);
  return Promise.all(items.map((item, index) => run(() => fn(item, index))));
}
