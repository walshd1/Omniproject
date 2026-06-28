import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { selectPersonas, personaById, personasEnabled, PERSONAS } from "./personas";

afterEach(() => { delete process.env["COPILOT_PERSONAS"]; });

test("every persona is well-formed (id, title, guidance, tags)", () => {
  for (const p of PERSONAS) {
    assert.ok(p.id && p.title && p.guidance.length > 0, p.id);
    assert.ok(p.keywords.length > 0 && p.methodologies.length > 0, p.id);
  }
});

test("selects the agile lead for a sprint/velocity question", () => {
  assert.equal(selectPersonas("how is our sprint velocity and backlog?")[0]!.id, "agile-delivery-lead");
});

test("selects the programme director for cross-project dependencies/benefits", () => {
  assert.equal(selectPersonas("which programme dependencies threaten our benefits?")[0]!.id, "programme-director");
});

test("selects the risk manager for risk/blocker questions", () => {
  assert.equal(selectPersonas("what are our biggest risks and blockers?")[0]!.id, "risk-assurance-manager");
});

test("a methodology tag outweighs stray keywords", () => {
  // "status" hits the PMO analyst, but the prince2 methodology pins the stage-gate PM.
  assert.equal(selectPersonas("give me a status", { methodology: "prince2" })[0]!.id, "stage-gate-pm");
});

test("no keyword/methodology match falls back to the PMO analyst", () => {
  assert.equal(selectPersonas("tell me something")[0]!.id, "pmo-analyst");
});

test("max returns multiple ranked personas", () => {
  const picked = selectPersonas("sprint risks and blockers", { max: 2 });
  assert.equal(picked.length, 2);
});

test("personasEnabled honours COPILOT_PERSONAS=off", () => {
  assert.equal(personasEnabled(), true);
  process.env["COPILOT_PERSONAS"] = "off";
  assert.equal(personasEnabled(), false);
});

test("personaById resolves a known id", () => {
  assert.equal(personaById("pmo-analyst")?.title, "PMO Analyst");
  assert.equal(personaById("nope"), undefined);
});
