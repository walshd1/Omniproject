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
configure({ asyncUtilTimeout: 5000 });

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

// Some components persist UI state; give each test a clean localStorage.
afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});
