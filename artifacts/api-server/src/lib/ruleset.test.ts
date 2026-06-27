import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { evaluateRuleset, setRuleModes, getRuleModes, rulesetCatalogue, resetRuleModes, BUSINESS_RULES, setFieldRules, getFieldRules } from "./ruleset";

afterEach(() => resetRuleModes());

test("all rules default to off — the engine is inert until an admin opts in", () => {
  const modes = getRuleModes();
  for (const r of BUSINESS_RULES) assert.equal(modes[r.id], "off");
  const v = evaluateRuleset({ action: "delete_issue", write: true, role: "admin" });
  assert.equal(v.allow, true);
  assert.equal(v.warnings.length, 0);
});

test("a hard rule blocks the action", () => {
  setRuleModes({ "no-deletes": "hard" });
  const v = evaluateRuleset({ action: "delete_issue", write: true, role: "admin" });
  assert.equal(v.allow, false);
  assert.equal(v.blocked?.id, "no-deletes");
});

test("a warn rule allows but records a warning", () => {
  setRuleModes({ "require-assignee": "warn" });
  const v = evaluateRuleset({ action: "create_issue", write: true, role: "contributor", payload: { title: "x" } });
  assert.equal(v.allow, true);
  assert.equal(v.warnings[0]?.id, "require-assignee");
  // …and satisfied when the field is present:
  const ok = evaluateRuleset({ action: "create_issue", write: true, role: "contributor", payload: { title: "x", assignee: "u1" } });
  assert.equal(ok.warnings.length, 0);
});

test("read-only freezes every write but never reads", () => {
  setRuleModes({ "read-only": "hard" });
  assert.equal(evaluateRuleset({ action: "create_issue", write: true, role: "manager" }).allow, false);
  assert.equal(evaluateRuleset({ action: "list_issues", write: false, role: "viewer" }).allow, true);
});

test("SAFETY: the engine is restrict-only — there is no mode that grants", () => {
  // No setRuleModes value can make allow=false flip to a grant: the API only
  // accepts hard|warn|off, and unknown ids are ignored.
  const before = getRuleModes();
  setRuleModes({ "no-deletes": "allow", "made-up-rule": "hard", "read-only": "ALLOW" } as Record<string, unknown>);
  const after = getRuleModes();
  assert.deepEqual(after, before, "invalid/unknown modes are rejected");
  // And a passing verdict is the strongest the engine can return — allow:true with
  // (at most) warnings; it cannot emit anything that escalates privilege.
  const v = evaluateRuleset({ action: "create_issue", write: true, role: "viewer" });
  assert.equal(v.allow, true); // note: RBAC (the HARD gate) is what stops a viewer — not this engine
  assert.equal("blocked" in v && v.blocked, null);
});

test("field rule: 'no task without an effort estimate' (the example) blocks as hard", () => {
  setFieldRules([{ id: "require-estimate", action: "create_issue", field: "estimateHours", mode: "hard" }]);
  const blocked = evaluateRuleset({ action: "create_issue", write: true, role: "contributor", payload: { title: "x" } });
  assert.equal(blocked.allow, false);
  assert.equal(blocked.blocked?.id, "require-estimate");
  assert.match(blocked.blocked!.message, /estimateHours/);
  // …satisfied once the estimate is present:
  const ok = evaluateRuleset({ action: "create_issue", write: true, role: "contributor", payload: { title: "x", estimateHours: 3 } });
  assert.equal(ok.allow, true);
});

test("field rule: a DEPENDENCY only requires the field when its trigger is present", () => {
  setFieldRules([{ id: "cost-centre-when-billable", action: "create_issue", field: "costCenter", whenPresent: "billable", mode: "hard" }]);
  // billable not set → dependency dormant.
  assert.equal(evaluateRuleset({ action: "create_issue", write: true, role: "manager", payload: { title: "x" } }).allow, true);
  // billable set but no costCenter → blocked.
  const v = evaluateRuleset({ action: "create_issue", write: true, role: "manager", payload: { title: "x", billable: true } });
  assert.equal(v.allow, false);
  assert.equal(v.blocked?.id, "cost-centre-when-billable");
  // both present → fine.
  assert.equal(evaluateRuleset({ action: "create_issue", write: true, role: "manager", payload: { title: "x", billable: true, costCenter: "CC-1" } }).allow, true);
});

test("field rules are restrict-only + validated (malformed/grant rejected)", () => {
  setFieldRules([
    { id: "good", action: "create_issue", field: "estimateHours", mode: "warn" },
    { id: "bad-mode", action: "create_issue", field: "x", mode: "allow" }, // invalid mode → dropped
    { foo: "not a rule" },
  ] as unknown);
  const rules = getFieldRules();
  assert.equal(rules.length, 1);
  assert.equal(rules[0]!.id, "good");
});

test("the catalogue exposes each rule + its mode for the admin UI", () => {
  setRuleModes({ "no-deletes": "warn" });
  const cat = rulesetCatalogue();
  assert.equal(cat.find((r) => r.id === "no-deletes")?.mode, "warn");
  assert.ok(cat.every((r) => r.label && r.description && r.defaultMode));
});
