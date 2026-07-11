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
      // Recalibrated for the vitest/@vitest/coverage-v8 3.2.6 -> 4.1.9 major bump: v8's
      // new instrumentation counts statements/branches differently (measured
      // statements/branches/lines all dropped a few points with NO source or test changes,
      // while functions coverage rose — the signature of a counting-method shift, not a real
      // regression). Current measured: ~81% statements, ~75% branches, ~74% functions, ~84% lines.
      // Raise these as coverage grows.
      thresholds: {
        statements: 80,
        branches: 74,
        functions: 70,
        lines: 83,
      },
    },
  },
});
