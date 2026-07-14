import { configureAxe } from "vitest-axe";

/**
 * axe-core configured for the full industry standard: WCAG 2.0 / 2.1 / 2.2, Level A + AA — the
 * conformance target OmniProject claims (see docs/ACCESSIBILITY-CONFORMANCE.md). Use `expectNoAxe`
 * in a jsdom test to catch the STRUCTURAL criteria automatable without layout (names/roles/values,
 * labels, landmarks, list/heading structure, duplicate ids, ARIA validity). Layout-dependent criteria
 * — contrast (1.4.3/1.4.11), target size (2.5.8), reflow (1.4.10) — need the real-browser Playwright
 * axe job and the manual pass documented in the conformance report; they are audited there, not here.
 */
export const axe = configureAxe({
  rules: {
    // jsdom performs no layout, so colour-contrast/target-size cannot be evaluated here (they'd throw
    // "incomplete"); those are covered by the browser axe job + manual audit.
    "color-contrast": { enabled: false },
    "target-size": { enabled: false },
  },
});

/** WCAG 2.0/2.1/2.2 A+AA tag set — pass as `{ runOnly: WCAG_AA }` to scope a scan to the standard. */
export const WCAG_AA = { type: "tag" as const, values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] };

/** Assert a rendered container has ZERO WCAG A/AA violations; on failure, list each rule id + the
 *  offending nodes so the defect is actionable. */
export async function expectNoAxe(container: Element): Promise<void> {
  const results = await axe(container, { runOnly: WCAG_AA });
  const violations = results.violations ?? [];
  if (violations.length > 0) {
    const report = violations
      .map((v) => `  [${v.impact ?? "?"}] ${v.id}: ${v.help}\n${v.nodes.map((n) => `      → ${n.target.join(" ")}`).join("\n")}`)
      .join("\n");
    throw new Error(`axe found ${violations.length} WCAG A/AA violation(s):\n${report}`);
  }
}
