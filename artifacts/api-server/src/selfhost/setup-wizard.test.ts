import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialWizardState,
  wizardReducer,
  guardrails,
  blockers,
  canComplete,
  holdsOnlyCopy,
  toConfig,
  configToGatingInput,
  type WizardState,
} from "./setup-wizard";
import { resolveGating } from "./capability-gating";

test("initial state is off, nothing adopted, nothing acknowledged, and completes trivially", () => {
  assert.deepEqual(initialWizardState, { mode: "off", adopted: [], acknowledgedDataResponsibility: false });
  assert.equal(canComplete(initialWizardState), true);
});

test("choosing a non-off mode requires the data-responsibility ack to complete (the one BLOCK)", () => {
  const s = wizardReducer(initialWizardState, { type: "setMode", mode: "system-of-record" });
  const bs = blockers(s);
  assert.equal(bs.length, 1);
  assert.equal(bs[0]!.id, "data-responsibility");
  assert.equal(canComplete(s), false);
});

test("acknowledging unblocks completion", () => {
  let s = wizardReducer(initialWizardState, { type: "setMode", mode: "system-of-record" });
  s = wizardReducer(s, { type: "acknowledgeDataResponsibility", value: true });
  assert.equal(canComplete(s), true);
  assert.equal(blockers(s).length, 0);
});

test("switching back to off clears the ack and re-completes", () => {
  let s = wizardReducer(initialWizardState, { type: "setMode", mode: "augmenting" });
  s = wizardReducer(s, { type: "acknowledgeDataResponsibility", value: true });
  s = wizardReducer(s, { type: "setMode", mode: "off" });
  assert.equal(s.acknowledgedDataResponsibility, false);
  assert.equal(canComplete(s), true);
});

test("toggling adopts and un-adopts a gated domain; duplicates never accumulate", () => {
  let s = wizardReducer(initialWizardState, { type: "toggleDomain", id: "financials" });
  assert.deepEqual(s.adopted, ["financials"]);
  s = wizardReducer(s, { type: "toggleDomain", id: "financials" });
  assert.deepEqual(s.adopted, []);
});

test("core domain (issues) is not a toggle — toggling it is a no-op", () => {
  const s = wizardReducer(initialWizardState, { type: "toggleDomain", id: "issues" });
  assert.deepEqual(s.adopted, []);
});

test("all four guardrails are always returned; the mode drives which are active", () => {
  const off = guardrails(initialWizardState);
  assert.equal(off.length, 4);
  assert.ok(off.every((g) => !g.active), "off ⇒ no guardrail active");

  const sor = guardrails({ mode: "system-of-record", adopted: [], acknowledgedDataResponsibility: false });
  assert.ok(sor.find((g) => g.id === "data-responsibility")!.active);
  assert.ok(sor.find((g) => g.id === "prefer-existing-tool")!.active);
  assert.ok(sor.find((g) => g.id === "system-of-record-authority")!.active);
  assert.ok(!sor.find((g) => g.id === "augmenting-fills-gaps-only")!.active);

  const aug = guardrails({ mode: "augmenting", adopted: [], acknowledgedDataResponsibility: true });
  assert.ok(aug.find((g) => g.id === "augmenting-fills-gaps-only")!.active);
  assert.ok(!aug.find((g) => g.id === "system-of-record-authority")!.active);
});

test("exactly one guardrail is a blocking level", () => {
  const blocks = guardrails(initialWizardState).filter((g) => g.level === "block");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.id, "data-responsibility");
});

test("holdsOnlyCopy is true for any non-off adoption (the fact the ack is about)", () => {
  assert.equal(holdsOnlyCopy({ mode: "off" }), false);
  assert.equal(holdsOnlyCopy({ mode: "augmenting" }), true);
  assert.equal(holdsOnlyCopy({ mode: "system-of-record" }), true);
});

test("toConfig refuses to serialise an un-acknowledged adoption", () => {
  const s: WizardState = { mode: "system-of-record", adopted: ["financials"], acknowledgedDataResponsibility: false };
  assert.throws(() => toConfig(s), /cannot complete/);
});

test("toConfig serialises an acknowledged adoption; it round-trips into a gating input", () => {
  let s = wizardReducer(initialWizardState, { type: "setMode", mode: "system-of-record" });
  s = wizardReducer(s, { type: "toggleDomain", id: "financials" });
  s = wizardReducer(s, { type: "acknowledgeDataResponsibility", value: true });
  const config = toConfig(s);
  assert.deepEqual(config, { mode: "system-of-record", adopted: ["financials"], acknowledgedDataResponsibility: true });

  const gating = resolveGating(configToGatingInput(config));
  assert.ok(gating.enabledDomainIds.has("issues"));
  assert.ok(gating.enabledDomainIds.has("financials"));
});

test("off config completes and produces a gating with nothing enabled", () => {
  const config = toConfig(initialWizardState);
  assert.equal(config.mode, "off");
  const gating = resolveGating(configToGatingInput(config));
  assert.equal(gating.enabledDomainIds.size, 0);
});
