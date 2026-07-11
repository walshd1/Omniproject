import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resolveScope, programmesFromGroups, inScope, filterInScope, type Scope } from "./scope";
import { AUTHORITIES, type Grants, type Role } from "./rbac";

/** Build a Grants fixture from a base rung + authorities. */
function grants(base: "viewer" | "contributor" | "manager", ...auth: Role[]): Grants {
  return { base, authorities: new Set(auth.filter((a): a is (typeof AUTHORITIES)[number] => a === "pmo" || a === "admin")) };
}

afterEach(() => { delete process.env["OIDC_PROGRAMME_GROUP_PREFIX"]; });

test("resolveScope: pmo and admin get all-data scope", () => {
  assert.deepEqual(resolveScope(grants("manager", "admin"), { sub: "a", groups: [] }), { level: "all" });
  assert.deepEqual(resolveScope(grants("manager", "pmo"), { sub: "a", groups: [] }), { level: "all" });
});

test("resolveScope: a manager is scoped to their owned programmes (from groups)", () => {
  const s = resolveScope(grants("manager"), { sub: "pm-1", groups: ["programme:alpha", "programme:beta", "other-group"] });
  assert.equal(s.level, "programme");
  assert.equal(s.sub, "pm-1");
  assert.deepEqual([...(s.programmes ?? [])].sort(), ["alpha", "beta"]);
});

test("resolveScope: a standard user (contributor/viewer) is user-level", () => {
  assert.deepEqual(resolveScope(grants("contributor"), { sub: "u-1", groups: [] }), { level: "user", sub: "u-1" });
  assert.deepEqual(resolveScope(grants("viewer"), { sub: "u-2", groups: [] }), { level: "user", sub: "u-2" });
});

test("programmesFromGroups honours a configurable prefix and is case-insensitive", () => {
  assert.deepEqual(programmesFromGroups(["Programme:Alpha", "PROGRAMME:beta", "x"]).sort(), ["alpha", "beta"]);
  process.env["OIDC_PROGRAMME_GROUP_PREFIX"] = "prog/";
  assert.deepEqual(programmesFromGroups(["prog/gamma", "programme:alpha"]), ["gamma"]);
});

test("inScope: all-level admits everything", () => {
  const all: Scope = { level: "all" };
  assert.ok(inScope(all, {}));
  assert.ok(inScope(all, { programmeId: "x" }));
});

test("inScope: programme-level admits only owned programmes, fail-closed on unattributable", () => {
  const s: Scope = { level: "programme", sub: "pm", programmes: ["alpha"] };
  assert.ok(inScope(s, { programmeId: "alpha" }));
  assert.ok(!inScope(s, { programmeId: "beta" }));
  assert.ok(!inScope(s, { programmeId: null })); // no programme ⇒ out of scope
  assert.ok(!inScope(s, {}));
});

test("inScope: user-level admits owned or member resources, fail-closed otherwise", () => {
  const s: Scope = { level: "user", sub: "u-1" };
  assert.ok(inScope(s, { ownerSub: "u-1" }));
  assert.ok(inScope(s, { memberSubs: ["u-9", "u-1"] }));
  assert.ok(!inScope(s, { ownerSub: "u-2" }));
  assert.ok(!inScope(s, {})); // unattributable ⇒ denied
  assert.ok(!inScope({ level: "user" }, { ownerSub: "u-1" })); // no sub ⇒ denied
});

test("filterInScope: all ⇒ unchanged; scoped ⇒ filtered", () => {
  const rows = [{ programmeId: "alpha" }, { programmeId: "beta" }, { programmeId: null }];
  assert.equal(filterInScope({ level: "all" }, rows).length, 3);
  const scoped = filterInScope({ level: "programme", programmes: ["alpha"] }, rows);
  assert.deepEqual(scoped, [{ programmeId: "alpha" }]);
});
