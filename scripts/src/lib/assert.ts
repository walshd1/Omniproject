/**
 * Shared pass/fail assertion helper for the script-level verifiers (verify-broker-contract,
 * e2e-smoke, integration-openproject): prints a checkmark/cross per label and tallies totals so
 * each script's `main()` can report a summary and exit non-zero on any failure.
 */
export const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
export const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
export const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

export interface Asserter {
  assert(label: string, cond: boolean, detail?: string): void;
  readonly pass: number;
  readonly fail: number;
}

/** A fresh, independent pass/fail tally + printer for one script run. */
export function createAsserter(): Asserter {
  let pass = 0;
  let fail = 0;
  return {
    assert(label, cond, detail) {
      if (cond) { console.log(`  ${green("✓")} ${label}`); pass++; }
      else { console.log(`  ${red("✗")} ${label}${detail ? ` — ${detail}` : ""}`); fail++; }
    },
    get pass() { return pass; },
    get fail() { return fail; },
  };
}
