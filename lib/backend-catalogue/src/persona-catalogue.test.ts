import { test } from "node:test";
import assert from "node:assert/strict";
import { PERSONAS, getPersona, personaCatalogue } from "./persona-catalogue";

/**
 * Persona registry — embedded from assets/personas/*.json. The selection/injection logic
 * lives in the gateway; here we only pin the catalogue accessors and shape.
 */

test("PERSONAS is a non-empty array of well-formed persona packs", () => {
  assert.ok(Array.isArray(PERSONAS));
  assert.ok(PERSONAS.length > 0);
  for (const p of PERSONAS) {
    assert.equal(typeof p.id, "string");
    assert.equal(typeof p.title, "string");
    assert.ok(Array.isArray(p.methodologies));
    assert.ok(Array.isArray(p.keywords));
    assert.equal(typeof p.guidance, "string");
  }
});

test("getPersona resolves a real id and returns undefined for an unknown one", () => {
  const first = PERSONAS[0]!;
  const found = getPersona(first.id);
  assert.equal(found?.id, first.id);
  assert.equal(getPersona("no-such-persona"), undefined);
});

test("personaCatalogue returns a defensive copy (new array and cloned entries)", () => {
  const a = personaCatalogue();
  const b = personaCatalogue();
  assert.notEqual(a, b, "each call returns a fresh array");
  assert.notEqual(a, PERSONAS, "does not hand back the internal array");
  assert.equal(a.length, PERSONAS.length);
  assert.notEqual(a[0], PERSONAS[0], "entries are shallow-cloned");
  assert.deepEqual(a[0], PERSONAS[0]);
  // Mutating the copy must not affect the source registry.
  a[0]!.title = "mutated";
  assert.notEqual(PERSONAS[0]!.title, "mutated");
});
