import { test } from "node:test";
import assert from "node:assert/strict";
import { getReferenceRuleset, referenceRulesetCatalogue } from "./methodology-rulesets";
import { METHODOLOGIES } from "./methodology-catalogue";

test("getReferenceRuleset returns a deep copy keyed by methodology id, undefined when unknown", () => {
  // Pick a methodology that actually ships a reference ruleset.
  const withRuleset = METHODOLOGIES.map((m) => m.id).find((id) => getReferenceRuleset(id));
  assert.ok(withRuleset, "at least one methodology must ship a reference ruleset");
  const rs = getReferenceRuleset(withRuleset!)!;
  assert.equal(rs.methodology, withRuleset, "the bundle carries its methodology id");
  assert.equal(rs.id, withRuleset);

  // Deep copy: mutating the returned bundle must not leak back into a fresh read.
  const before = getReferenceRuleset(withRuleset!)!;
  rs.fieldRules.push({ id: "injected", action: "any-write", field: "x", mode: "hard" });
  rs.modes["injected"] = "hard";
  const after = getReferenceRuleset(withRuleset!)!;
  assert.equal(after.fieldRules.length, before.fieldRules.length, "fieldRules is a copy");
  assert.equal(after.modes["injected"], undefined, "modes is a copy");

  // Unknown methodology → undefined (the ternary's false branch).
  assert.equal(getReferenceRuleset("no-such-methodology"), undefined);
});

test("referenceRulesetCatalogue yields the shipped bundles, each a real ReferenceRuleset ordered by methodology", () => {
  const cat = referenceRulesetCatalogue();
  assert.ok(cat.length > 0, "at least one reference ruleset ships");
  // Never contains an undefined hole (the filter strips methodologies without a bundle).
  for (const rs of cat) {
    assert.ok(rs, "no undefined entries");
    assert.ok(rs.methodology && rs.id === rs.methodology, "each carries a methodology id");
    assert.ok(Array.isArray(rs.fieldRules) && typeof rs.modes === "object");
  }
  // Order tracks the methodology catalogue (bundles line up with their planes).
  const methodologyOrder = METHODOLOGIES.map((m) => m.id);
  const catOrder = cat.map((rs) => rs.methodology);
  const filtered = methodologyOrder.filter((id) => catOrder.includes(id));
  assert.deepEqual(catOrder, filtered, "catalogue order matches methodology display order");
});
