import { test } from "node:test";
import assert from "node:assert/strict";
import { stricterMode, tightenModes, tightenFieldRules, resolveEffectiveRuleset } from "./ruleset-scope";
import type { FieldRule, RuleMode } from "./ruleset";
import { DEFAULT_ACCOUNTING } from "./accounting-policy";

test("stricterMode never loosens (off < warn < hard)", () => {
  assert.equal(stricterMode("off", "hard"), "hard");
  assert.equal(stricterMode("hard", "off"), "hard"); // a looser override can't win
  assert.equal(stricterMode("warn", "hard"), "hard");
  assert.equal(stricterMode("hard", "warn"), "hard");
});

test("tightenModes raises a mode but never lowers it", () => {
  const base: Record<string, RuleMode> = { a: "warn", b: "hard", c: "off" };
  const out = tightenModes(base, { a: "hard", b: "off", c: "warn", d: "hard" });
  assert.equal(out["a"], "hard"); // raised warn → hard
  assert.equal(out["b"], "hard"); // override off ignored (can't loosen)
  assert.equal(out["c"], "warn"); // raised off → warn
  assert.equal(out["d"], "hard"); // a brand-new rule the scope hardens
});

test("tightenFieldRules keeps base rules, adds override-only, raises but never lowers a shared id", () => {
  const base: FieldRule[] = [{ id: "r1", action: "any-write", field: "owner", mode: "warn" }];
  const override: FieldRule[] = [
    { id: "r1", action: "any-write", field: "owner", mode: "off" },   // tries to loosen r1 → ignored
    { id: "r2", action: "create_issue", field: "dueDate", mode: "hard" }, // new required field
  ];
  const out = tightenFieldRules(base, override);
  const r1 = out.find((r) => r.id === "r1")!;
  const r2 = out.find((r) => r.id === "r2")!;
  assert.equal(r1.mode, "warn"); // NOT loosened to off
  assert.equal(r2.mode, "hard"); // added
  assert.equal(out.length, 2);
});

test("a raise of a shared field rule wins", () => {
  const base: FieldRule[] = [{ id: "r1", action: "any-write", field: "owner", mode: "warn" }];
  const out = tightenFieldRules(base, [{ id: "r1", action: "any-write", field: "owner", mode: "hard" }]);
  assert.equal(out[0]!.mode, "hard");
});

test("resolveEffectiveRuleset with no scopes returns the baseline unchanged (modes, fields, accounting, domainModes)", () => {
  const base = { modes: { a: "warn" as RuleMode }, fieldRules: [{ id: "r1", action: "any-write", field: "owner", mode: "warn" as RuleMode }], accounting: DEFAULT_ACCOUNTING, domainModes: { finance: "warn" as RuleMode } };
  const eff = resolveEffectiveRuleset(base, {});
  assert.deepEqual(eff.modes, base.modes);
  assert.deepEqual(eff.fieldRules, base.fieldRules);
  assert.deepEqual(eff.accounting, DEFAULT_ACCOUNTING);
  assert.deepEqual(eff.domainModes, base.domainModes);
});

test("domain floors fold tighten-only through tightenModes (raise, never lower, add new)", () => {
  const base: Record<string, RuleMode> = { finance: "warn", delivery: "hard", people: "off" };
  const out = tightenModes(base, { finance: "hard", delivery: "off", people: "warn", general: "hard" });
  assert.equal(out["finance"], "hard"); // raised warn → hard
  assert.equal(out["delivery"], "hard"); // override off ignored (can't loosen)
  assert.equal(out["people"], "warn"); // raised off → warn
  assert.equal(out["general"], "hard"); // a domain the scope newly floors
});
