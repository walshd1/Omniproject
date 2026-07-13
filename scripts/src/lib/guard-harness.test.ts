import { test } from "node:test";
import assert from "node:assert/strict";
import { formatGuard } from "./guard-harness";

test("passing guard prints one OK line, nothing on stderr", () => {
  const out = formatGuard("superset", { violations: [], okSummary: "12 backends, all ⊆ superset" });
  assert.equal(out.ok, true);
  assert.deepEqual(out.stdout, ["superset guard: OK — 12 backends, all ⊆ superset"]);
  assert.deepEqual(out.stderr, []);
});

test("failing guard emits a ::error:: headline, bulleted violations, and help", () => {
  const out = formatGuard("widget-coverage", {
    violations: ['widget "burndown" has no renderer', 'renderer "orphan" is unused'],
    okSummary: "n/a",
    help: "Author the widget JSON.",
  });
  assert.equal(out.ok, false);
  assert.deepEqual(out.stdout, []);
  assert.deepEqual(out.stderr, [
    "::error::widget-coverage guard failed",
    '  - widget "burndown" has no renderer',
    '  - renderer "orphan" is unused',
    "",
    "Author the widget JSON.",
  ]);
});

test("a custom failHeadline overrides the default", () => {
  const out = formatGuard("compose", { violations: ["x"], okSummary: "n/a", failHeadline: "compose guard: FAILED — 1 issue(s)" });
  assert.equal(out.stderr[0], "::error::compose guard: FAILED — 1 issue(s)");
});

test("failure without help omits the trailing blank+help lines", () => {
  const out = formatGuard("interactive-parity", { violations: ["a:1 — not keyboard-operable"], okSummary: "n/a" });
  assert.deepEqual(out.stderr, ["::error::interactive-parity guard failed", "  - a:1 — not keyboard-operable"]);
});
