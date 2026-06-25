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
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/components/ui/**",
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
        "src/.generated/**",
      ],
      // Ratchet: floors set just below measured coverage to prevent regressions.
      // Current: ~88.6% lines/statements, ~87.6% branches, ~64% functions (the
      // function number trails because many small inline handlers/callbacks
      // aren't individually invoked). Raise these as coverage grows.
      thresholds: {
        statements: 85,
        branches: 84,
        functions: 60,
        lines: 85,
      },
    },
  },
});
