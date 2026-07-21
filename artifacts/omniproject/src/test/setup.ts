import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// Unmount React trees between tests so the DOM and effects don't leak across cases.
afterEach(() => cleanup());

// findBy*/waitFor's default 1000ms ceiling is tight enough that CI's coverage-instrumented,
// fully-parallel run occasionally trips it under CPU contention on a slow async update (e.g.
// a toast firing after several userEvent interactions) even though the same test passes
// reliably every time in isolation. Raising the ceiling doesn't slow passing tests down —
// they still resolve as soon as the assertion is true — it only gives a genuinely slow CI
// run more room before failing.
//
// The ceiling is generous (12s) specifically because coverage runs under the ISTANBUL provider,
// which instruments every module at transform time. The first test in a process to touch a big
// lazy route (App's `ScreenPage`, which transitively pulls in the whole view-engine/panels/charts
// tree) pays a one-time cold-import cost while all those modules are instrumented — several seconds
// on a busy runner, and once PER SHARD process (each shard is a fresh process, so the cold cost
// isn't amortised across the suite the way it is in a single unsharded run). 12s absorbs that
// cold-load spike; warm loads and everything else still resolve immediately.
configure({ asyncUtilTimeout: 12000 });

// ── jsdom polyfills ──────────────────────────────────────────────────────────
// jsdom omits several browser APIs that Radix UI, recharts and our own code use.
// Stub them so component tests render instead of throwing.

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

class IntersectionObserverStub {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.IntersectionObserver ??= IntersectionObserverStub as unknown as typeof IntersectionObserver;

// Radix relies on these pointer-capture + scroll APIs that jsdom doesn't implement.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

// localStorage polyfill. Newer Node (26+) ships a built-in Web Storage global that is file-backed and
// inert by default; under vitest's jsdom environment it collides with jsdom's own, leaving
// `window.localStorage` unusable (accessing it throws / is undefined). Install a minimal in-memory
// Storage when the runtime's is not usable, so component tests that persist UI state work on ANY Node
// version. This is a NO-OP where a working localStorage already exists (e.g. Node 22 + jsdom).
function ensureUsableLocalStorage(target: Window & typeof globalThis): void {
  try {
    target.localStorage.setItem("__probe__", "1");
    target.localStorage.removeItem("__probe__");
    return; // existing one works — keep it
  } catch {
    /* fall through and install an in-memory Storage */
  }
  const store = new Map<string, string>();
  const memory: Storage = {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => void store.delete(k),
    setItem: (k, v) => void store.set(String(k), String(v)),
  };
  Object.defineProperty(target, "localStorage", { configurable: true, value: memory });
}
ensureUsableLocalStorage(window as Window & typeof globalThis);

// Some components persist UI state; give each test a clean localStorage.
afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});
