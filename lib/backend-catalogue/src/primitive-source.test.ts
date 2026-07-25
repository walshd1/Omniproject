import test from "node:test";
import assert from "node:assert/strict";
import { PRIMITIVE_CATALOGUE, rootPrimitives, resolvePrimitive, getPrimitive } from "./primitive-catalogue";
import { validatePrimitiveDef } from "./primitive-schema";
import { primitiveSafetyErrors } from "./primitive-safety";

/**
 * THE SOURCE BOUNDARY: only ROOT primitives (built on nothing — no `extends`) are code (TypeScript). Every
 * DERIVED primitive (it `extends` an ancestor) is DATA, authored as a JSON recipe under primitives/. This
 * pins that rule: the split is roots-only-in-TS, and every derived recipe is a valid, resolvable primitive.
 */

test("`blank` is the system bootstrap root a bespoke primitive can extend", () => {
  const blank = getPrimitive("blank");
  assert.ok(blank, "the blank base is shipped");
  assert.equal(blank!.extends, undefined, "blank is a root");
  assert.equal(blank!.category, "custom");
  assert.ok(rootPrimitives().some((p) => p.id === "blank"));
  // A bespoke primitive that starts a fresh family by extending `blank` is a well-formed, safe customer primitive.
  const bespoke = { id: "acme-widget", label: "Acme widget", category: "custom" as const, extends: "blank", description: "a new bespoke family", params: [] };
  assert.equal(validatePrimitiveDef(bespoke).ok, true);
  assert.deepEqual(primitiveSafetyErrors(validatePrimitiveDef(bespoke).def!), []);
  assert.equal(resolvePrimitive("blank")!.lineage.at(-1), "blank");
});

test("a primitive is a ROOT (no extends) or a DERIVED recipe (extends) — nothing in between", () => {
  const roots = PRIMITIVE_CATALOGUE.filter((p) => !p.extends);
  const derived = PRIMITIVE_CATALOGUE.filter((p) => p.extends);
  assert.equal(roots.length + derived.length, PRIMITIVE_CATALOGUE.length);
  assert.deepEqual(rootPrimitives().map((p) => p.id).sort(), roots.map((p) => p.id).sort());
  assert.ok(roots.length > 0 && derived.length > 0);
});

test("every derived primitive is a valid recipe whose extends chain resolves to a root", () => {
  for (const p of PRIMITIVE_CATALOGUE.filter((d) => d.extends)) {
    const v = validatePrimitiveDef(p);
    assert.ok(v.ok, `${p.id} is a valid primitive def: ${v.errors.join("; ")}`);
    const resolved = resolvePrimitive(p.id);
    assert.ok(resolved, `${p.id} resolves`);
    const root = resolved!.lineage.at(-1)!;
    assert.equal(PRIMITIVE_CATALOGUE.find((x) => x.id === root)!.extends, undefined, `${p.id} bottoms out at a root`);
  }
});

test("every catalogue primitive — root or derived — validates against the one contract", () => {
  for (const p of PRIMITIVE_CATALOGUE) {
    assert.ok(validatePrimitiveDef(p).ok, `${p.id} validates`);
  }
});
