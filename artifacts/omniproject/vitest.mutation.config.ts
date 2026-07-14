import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

/**
 * Scoped Vitest config for MUTATION testing (Stryker). It reuses the base setup but includes ONLY the
 * money/FX correctness test files, so Stryker's dry run is fast and the mutant test runs stay tight —
 * mutation testing runs the covering tests once PER mutant, so a whole-suite scope would be far too
 * slow for CI. Coverage thresholds are irrelevant here and dropped. Keep this test set in step with the
 * `mutate` globs in stryker.conf.json.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: [
        "src/lib/currency.test.ts",
        "src/lib/portfolio-value.test.ts",
        "src/lib/benefits-realisation.test.ts",
        "src/lib/portfolio-priority.test.ts",
        "src/lib/funding-scenario.test.ts",
        "src/lib/scenario.test.ts",
        "src/lib/currency-fold-invariants.test.ts",
      ],
      coverage: { enabled: false },
    },
  }),
);
