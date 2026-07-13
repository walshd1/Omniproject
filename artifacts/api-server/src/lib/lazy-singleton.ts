/**
 * A process-wide lazy singleton: build once on first access, memoize, and expose a test/hot-reload
 * seam to drop or inject the instance. This folds the `let x: T | null = null; if (!x) x = factory()`
 * idiom that every process-global (fan-out buses, caches, archive store, …) re-implemented by hand —
 * putting the null-check, the reset, and the "read without creating" in one tested primitive so the
 * per-module boilerplate (and the occasional forgotten reset) goes away.
 *
 * Deliberately tiny and dependency-free: it holds a closure over one nullable slot, nothing more.
 */
export interface LazySingleton<T> {
  /** Get the instance, building it (via the factory) on first call, then memoized. */
  get(): T;
  /** The current instance WITHOUT building it — null before the first `get()` or after a `reset()`. */
  peek(): T | null;
  /** Drop the instance so the next `get()` rebuilds — or inject a specific one (test seam). */
  reset(value?: T | null): void;
}

/** Build a lazy singleton around `factory`, which is invoked at most once per live instance. */
export function lazySingleton<T>(factory: () => T): LazySingleton<T> {
  let instance: T | null = null;
  return {
    get: () => (instance ??= factory()),
    peek: () => instance,
    reset: (value: T | null = null) => { instance = value; },
  };
}
