import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { evaluateRuleset, setRuleModes, getRuleModes, rulesetCatalogue, resetRuleModes, BUSINESS_RULES, setFieldRules, getFieldRules, applyRuleset, entryRequirements } from "./ruleset";
import { getReferenceRuleset, referenceRulesetCatalogue } from "@workspace/backend-catalogue";

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

test("require-priority: hard-blocks a create with no priority on BOTH the task and issue surface", () => {
  setRuleModes({ "require-priority": "hard" });
  for (const action of ["create_issue", "create_task"]) {
    const blocked = evaluateRuleset({ action, write: true, role: "manager", payload: { title: "x" } });
    assert.equal(blocked.allow, false, `${action} with no priority should block`);
    assert.equal(blocked.blocked?.id, "require-priority");
  }
  // The UI's "none" sentinel must count as UNSET — otherwise the default the create forms send would
  // trivially satisfy the rule.
  assert.equal(evaluateRuleset({ action: "create_task", write: true, role: "manager", payload: { title: "x", priority: "none" } }).allow, false);
  assert.equal(evaluateRuleset({ action: "create_task", write: true, role: "manager", payload: { title: "x", priority: "  NONE " } }).allow, false);
  // A real priority satisfies it.
  assert.equal(evaluateRuleset({ action: "create_task", write: true, role: "manager", payload: { title: "x", priority: "high" } }).allow, true);
});

test("entryRequirements: distils the effective field requirements a client can pre-check", () => {
  // Off by default → nothing to enforce inline.
  assert.deepEqual(entryRequirements(), []);
  setRuleModes({ "require-priority": "hard" });
  const reqs = entryRequirements();
  const taskReq = reqs.find((r) => r.action === "create_task" && r.field === "priority");
  assert.ok(taskReq && taskReq.mode === "hard", "priority is a hard requirement on create_task");
  assert.ok(reqs.some((r) => r.action === "create_issue" && r.field === "priority"), "and on create_issue");
  // Admin field rules are folded in too.
  setFieldRules([{ id: "own", action: "create_issue", field: "owner", mode: "warn" }]);
  assert.ok(entryRequirements().some((r) => r.rule === "own" && r.field === "owner" && r.mode === "warn"));
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

test("built-in 'due-after-start' — a cross-field comparison field rules can't express", () => {
  setRuleModes({ "due-after-start": "hard" });
  // due before start → blocked.
  const bad = evaluateRuleset({ action: "create_issue", write: true, role: "manager", payload: { title: "x", startDate: "2026-02-01", dueDate: "2026-01-01" } });
  assert.equal(bad.allow, false);
  assert.equal(bad.blocked?.id, "due-after-start");
  // due after start → fine; and absent dates never trigger it.
  assert.equal(evaluateRuleset({ action: "create_issue", write: true, role: "manager", payload: { title: "x", startDate: "2026-01-01", dueDate: "2026-02-01" } }).allow, true);
  assert.equal(evaluateRuleset({ action: "create_issue", write: true, role: "manager", payload: { title: "x" } }).allow, true);
});

test("applyRuleset loads a bundle deterministically (unlisted built-ins reset to off)", () => {
  // Pre-dirty the engine, then apply a bundle that only mentions due-after-start.
  setRuleModes({ "no-deletes": "hard", "read-only": "warn" });
  applyRuleset({ modes: { "due-after-start": "hard" }, fieldRules: [{ id: "fr", action: "create_issue", field: "estimateHours", mode: "warn" }] });
  const modes = getRuleModes();
  assert.equal(modes["due-after-start"], "hard");
  assert.equal(modes["no-deletes"], "off", "unlisted built-ins reset to off");
  assert.equal(modes["read-only"], "off");
  assert.equal(getFieldRules().length, 1);
});

test("reference rulesets: every methodology bundle is restrict-only + references known rules", () => {
  const builtinIds = new Set(BUSINESS_RULES.map((r) => r.id));
  const VALID = new Set(["hard", "warn", "off"]);
  const cat = referenceRulesetCatalogue();
  assert.ok(cat.length >= 6, "a bundle per key methodology");
  for (const rs of cat) {
    // Mode keys must be real built-in ids; modes must be valid (no 'allow').
    for (const [id, mode] of Object.entries(rs.modes)) {
      assert.ok(builtinIds.has(id), `${rs.methodology}: unknown built-in '${id}'`);
      assert.ok(VALID.has(mode), `${rs.methodology}: invalid mode '${mode}'`);
    }
    // Field rules must be well-formed + restrict-only (only require a field).
    for (const fr of rs.fieldRules) {
      assert.ok(fr.id && fr.action && fr.field, `${rs.methodology}: malformed field rule`);
      assert.ok(VALID.has(fr.mode), `${rs.methodology}: invalid field-rule mode`);
    }
  }
});

test("reference ruleset: applying Scrum survives the engine's restrict-only guards", () => {
  const scrum = getReferenceRuleset("scrum");
  assert.ok(scrum);
  const applied = applyRuleset({ modes: scrum!.modes, fieldRules: scrum!.fieldRules });
  // Schedule sanity is hard; the field rule (story points) loaded as authored.
  assert.equal(applied.modes["due-after-start"], "hard");
  assert.ok(applied.fieldRules.some((r) => r.field === "storyPoints"));
});

test("the catalogue exposes each rule + its mode for the admin UI", () => {
  setRuleModes({ "no-deletes": "warn" });
  const cat = rulesetCatalogue();
  assert.equal(cat.find((r) => r.id === "no-deletes")?.mode, "warn");
  assert.ok(cat.every((r) => r.label && r.description && r.defaultMode));
});
