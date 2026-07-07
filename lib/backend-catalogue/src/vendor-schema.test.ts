import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, typeMatches, jsTypeOf, type JsonSchema } from "./vendor-schema";

/**
 * The minimal JSON-Schema validator (the subset the vendor schemas use). Exercises each
 * keyword branch and the type-mismatch short-circuit directly, since one algorithm serves
 * both the build-time generator and the runtime config loader.
 */

test("a type mismatch is reported and short-circuits deeper checks", () => {
  const schema: JsonSchema = { type: "object", required: ["id"], properties: { id: { type: "string" } } };
  const errs = validate(schema, "not-an-object");
  assert.equal(errs.length, 1, "only the type error, no required/property noise");
  assert.match(errs[0]!, /expected object, got string/);
});

test("enum membership is enforced", () => {
  const schema: JsonSchema = { enum: ["a", "b", "c"] };
  assert.deepEqual(validate(schema, "b"), []);
  const errs = validate(schema, "z");
  assert.match(errs[0]!, /is not one of/);
});

test("string pattern is enforced (and skipped for non-strings)", () => {
  const schema: JsonSchema = { type: "string", pattern: "^v[0-9]+$" };
  assert.deepEqual(validate(schema, "v12"), []);
  const errs = validate(schema, "nope");
  assert.match(errs[0]!, /does not match/);
});

test("object validation covers required, known props, unexpected props, and additionalProperties schemas", () => {
  const strict: JsonSchema = {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string" }, count: { type: "number" } },
    additionalProperties: false,
  };
  assert.deepEqual(validate(strict, { id: "x", count: 3 }), []);
  const missing = validate(strict, { count: 3 });
  assert.ok(missing.some((e) => e.includes('missing required property "id"')));
  const badProp = validate(strict, { id: 1 });
  assert.ok(badProp.some((e) => e.includes(".id")));
  const extra = validate(strict, { id: "x", bogus: true });
  assert.ok(extra.some((e) => e.includes('unexpected property "bogus"')));

  // additionalProperties as a schema validates each extra value against it.
  const mapSchema: JsonSchema = { type: "object", additionalProperties: { type: "string" } };
  assert.deepEqual(validate(mapSchema, { a: "x", b: "y" }), []);
  const mapErrs = validate(mapSchema, { a: 1 });
  assert.ok(mapErrs.some((e) => e.includes(".a")));
});

test("array items are validated positionally", () => {
  const schema: JsonSchema = { type: "array", items: { type: "number" } };
  assert.deepEqual(validate(schema, [1, 2, 3]), []);
  const errs = validate(schema, [1, "two", 3]);
  assert.ok(errs.some((e) => e.includes("[1]")));
});

test("typeMatches recognises every supported type including integer", () => {
  assert.ok(typeMatches("object", {}));
  assert.ok(!typeMatches("object", []));
  assert.ok(!typeMatches("object", null));
  assert.ok(typeMatches("array", []));
  assert.ok(typeMatches("string", "x"));
  assert.ok(typeMatches("number", 1.5));
  assert.ok(typeMatches("integer", 4));
  assert.ok(!typeMatches("integer", 4.5));
  assert.ok(typeMatches("boolean", true));
  assert.ok(typeMatches("anything-unknown", 123), "unknown types are permissive");
});

test("jsTypeOf distinguishes null, array and plain values", () => {
  assert.equal(jsTypeOf(null), "null");
  assert.equal(jsTypeOf([1, 2]), "array");
  assert.equal(jsTypeOf("s"), "string");
  assert.equal(jsTypeOf(3), "number");
  assert.equal(jsTypeOf({}), "object");
});
