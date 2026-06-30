import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCoverage, type CoverageProbes, type Impl } from "./coverage";

const allGood: CoverageProbes = { componentExists: () => true, wiredInPage: () => true, hasTest: () => true };

test("passes when every declared id maps to a built, wired, tested component", () => {
  const r = checkCoverage("reports", ["a", "b"], { a: "AComp", b: { surfacedVia: "view", reason: "x" } }, allGood);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test("fails a declared id with no implementation mapping (the orphan case)", () => {
  const r = checkCoverage("reports", ["a", "orphan"], { a: "AComp" }, allGood);
  assert.equal(r.ok, false);
  assert.match(r.errors.join("\n"), /"orphan" is declared in the catalogue but has no implementation/);
});

test("fails when a component is mapped but missing / unwired / untested", () => {
  const map: Record<string, Impl> = { a: "AComp" };
  assert.match(checkCoverage("p", ["a"], map, { ...allGood, componentExists: () => false }).errors.join(), /doesn't exist/);
  assert.match(checkCoverage("p", ["a"], map, { ...allGood, wiredInPage: () => false }).errors.join(), /isn't wired into the page/);
  assert.match(checkCoverage("p", ["a"], map, { ...allGood, hasTest: () => false }).errors.join(), /no test referencing it/);
});

test("flags a stale map entry for an id the catalogue no longer declares", () => {
  const r = checkCoverage("p", ["a"], { a: "AComp", gone: "GoneComp" }, allGood);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /stale entry for "gone"/);
});

test("surfaced-via entries are accepted without a component check", () => {
  const r = checkCoverage("p", ["g"], { g: { surfacedVia: "view", reason: "board" } }, { componentExists: () => false, wiredInPage: () => false, hasTest: () => false });
  assert.equal(r.ok, true);
});
