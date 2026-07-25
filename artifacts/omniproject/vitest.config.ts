import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Dedicated Vitest config (NOT vite.config.ts, which requires PORT/BASE_PATH env
 * at load for the dev/build server). Vitest auto-prefers this file. jsdom +
 * React Testing Library; coverage via v8. We deliberately exclude the vendored
 * shadcn `components/ui/**` and pure entry/boilerplate from coverage so the
 * number reflects OUR code.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    // Interaction-heavy RTL tests (userEvent typing, findBy* polling) run comfortably under ~2s
    // in isolation but can approach the old 5s default when the machine is saturated — e.g. the
    // root `pnpm -r test:coverage` used to fan every package's suite out at once. The aggregate is
    // now serial (--workspace-concurrency=1), and this generous ceiling removes the last of the
    // load-induced timeout flakiness so a busy CI runner can't tip a slow test over the edge.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      // istanbul (NOT v8): the v8 provider's post-test coverage remap reads every executed
      // module's source + source-map and rebuilds byte-range coverage in one process; on this
      // large jsdom suite that step exceeded a 13 GB heap and OOM'd (the tests themselves peak
      // at <200 MB — see CI notes). istanbul instruments at transform time with per-module
      // counters, so coverage memory is flat and independent of file count. No sharding needed.
      provider: "istanbul",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/components/ui/**",
        "src/**/*.test.{ts,tsx}",
        "src/**/*.bench.{ts,tsx}",
        "src/test/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/.generated/**",
      ],
      // Ratchet: floors set just below measured coverage to prevent regressions.
      // A full instrumented run (istanbul, whole suite, 3328 tests) measured 89.3% statements /
      // 82.2% branches / 85.8% functions / 91.8% lines. Floors sit ~1-2 points under those proven
      // numbers to absorb run-to-run variance while still catching a real regression. NOTE: these
      // are ISTANBUL numbers — lower than the old v8 figures for the SAME code because the two
      // providers count statements/branches differently (istanbul instruments the AST; v8 maps
      // byte ranges). The provider was switched from v8 to istanbul to fix an out-of-memory in the
      // coverage step (see the provider comment above), so the floors were re-measured to match.
      thresholds: {
        statements: 88,
        branches: 80,
        functions: 84,
        lines: 90,
      },
    },
  },
});
