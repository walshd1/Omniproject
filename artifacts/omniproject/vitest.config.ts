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
      provider: "v8",
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
      // After a large test push (≈+700 tests across the lowest-covered files), a full
      // instrumented run measured 93% statements / 86% branches / 90% functions / 95% lines,
      // and coverage has only risen since. Floors sit ~1-2 points under those proven numbers
      // to absorb run-to-run variance while still catching a real regression. NOTE: a literal
      // 95% branch floor is not yet attainable — a real slice of the remaining uncovered
      // branches are unreachable under jsdom (SSR `typeof window` guards, non-Error catch arms,
      // recharts render-props); reaching 95 branches needs those guards pruned/ignored in source.
      thresholds: {
        statements: 92,
        branches: 85,
        functions: 89,
        lines: 94,
      },
    },
  },
});
