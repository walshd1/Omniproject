import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveFeatures,
  effectiveEnabledIds,
  orgAllows,
  manageableAtProgramme,
  manageableAtProject,
  type FeatureGate,
} from "./feature-resolution";

const GATES: FeatureGate[] = [
  { id: "grid" }, // default-on
  { id: "globalSearch" }, // default-on
  { id: "presence", defaultOff: true, reason: "cost" },
  { id: "predictivePrefetch", defaultOff: true, reason: "cost" },
];

test("default-on features are enabled with no overrides; default-off features are not", () => {
  const r = effectiveEnabledIds(GATES);
  assert.ok(r.has("grid"));
  assert.ok(r.has("globalSearch"));
  assert.ok(!r.has("presence")); // default-off needs an explicit org opt-in
  assert.ok(!r.has("predictivePrefetch"));
});

test("org opt-in enables a default-off feature; org disable always wins", () => {
  assert.ok(orgAllows(GATES[2]!, new Set(), new Set(["presence"])));
  assert.ok(!orgAllows(GATES[2]!, new Set(), new Set())); // not opted in
  // explicit disable beats opt-in
  assert.ok(!orgAllows(GATES[2]!, new Set(["presence"]), new Set(["presence"])));
  // a default-on feature is allowed unless explicitly disabled
  assert.ok(orgAllows(GATES[0]!, new Set(), new Set()));
  assert.ok(!orgAllows(GATES[0]!, new Set(["grid"]), new Set()));
});

test("programme disable removes a feature for the programme (and its projects)", () => {
  const r = resolveFeatures(GATES, { programmeDisabled: ["grid"] });
  const grid = r.find((x) => x.id === "grid")!;
  assert.equal(grid.enabled, false);
  assert.equal(grid.blockedAt, "programme");
  // globalSearch untouched
  assert.equal(r.find((x) => x.id === "globalSearch")!.enabled, true);
});

test("project disable removes a feature for just that project", () => {
  const r = resolveFeatures(GATES, { projectDisabled: ["globalSearch"] });
  const gs = r.find((x) => x.id === "globalSearch")!;
  assert.equal(gs.enabled, false);
  assert.equal(gs.blockedAt, "project");
});

test("narrowing is monotonic: a programme/project can never add a feature the org disallowed", () => {
  // org disabled grid; programme/project have no 'enable' lever, so it stays off.
  const r = resolveFeatures(GATES, { orgDisabled: ["grid"], programmeDisabled: [], projectDisabled: [] });
  const grid = r.find((x) => x.id === "grid")!;
  assert.equal(grid.enabled, false);
  assert.equal(grid.blockedAt, "org"); // blocked at the highest level
  // a default-off feature not opted in at org also can't be turned on lower down
  assert.equal(effectiveEnabledIds(GATES, { programmeDisabled: [], projectDisabled: [] }).has("presence"), false);
});

test("blockedAt reports the highest blocking level when several apply", () => {
  const r = resolveFeatures(GATES, { orgDisabled: ["grid"], programmeDisabled: ["grid"], projectDisabled: ["grid"] });
  assert.equal(r.find((x) => x.id === "grid")!.blockedAt, "org");
});

test("full chain: org opts into presence, programme keeps it, project drops it", () => {
  const overrides = { orgEnabled: ["presence"], projectDisabled: ["presence"] };
  assert.ok(orgAllows(GATES[2]!, new Set(), new Set(["presence"])));
  const r = resolveFeatures(GATES, overrides);
  const p = r.find((x) => x.id === "presence")!;
  assert.equal(p.enabled, false);
  assert.equal(p.blockedAt, "project");
  // …but at programme scope (no project disable) it's on
  assert.equal(effectiveEnabledIds(GATES, { orgEnabled: ["presence"] }).has("presence"), true);
});

test("manageable sets enforce the parent ceiling", () => {
  // org allows grid + globalSearch + (opted-in) presence; predictivePrefetch stays out.
  const ov = { orgEnabled: ["presence"] };
  const prog = manageableAtProgramme(GATES, ov);
  assert.deepEqual([...prog].sort(), ["globalSearch", "grid", "presence"]);
  assert.ok(!prog.has("predictivePrefetch")); // org never allowed it → programme can't manage it
  // project ceiling excludes whatever the programme already removed
  const proj = manageableAtProject(GATES, { ...ov, programmeDisabled: ["grid"] });
  assert.deepEqual([...proj].sort(), ["globalSearch", "presence"]);
});
