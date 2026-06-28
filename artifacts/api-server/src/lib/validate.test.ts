import { test } from "node:test";
import assert from "node:assert/strict";
import { v, parseOr400, ValidationError } from "./validate";

test("string validator enforces type, trim, length and pattern", () => {
  assert.equal(v.string({ trim: true })("  hi  "), "hi");
  assert.throws(() => v.string()(42), ValidationError);
  assert.throws(() => v.string({ min: 2 })("a"), ValidationError);
  assert.throws(() => v.string({ max: 2 })("abc"), ValidationError);
  assert.throws(() => v.string({ pattern: /^[a-z]+$/ })("AB"), ValidationError);
});

test("number validator: finite, int, range, numeric-string coercion", () => {
  assert.equal(v.number()("3.5"), 3.5);
  assert.equal(v.number({ int: true, min: 0, max: 10 })(5), 5);
  assert.throws(() => v.number()("nope"), ValidationError);
  assert.throws(() => v.number({ int: true })(1.5), ValidationError);
  assert.throws(() => v.number({ max: 10 })(11), ValidationError);
});

test("enum + boolean + array", () => {
  assert.equal(v.enum(["a", "b"] as const)("b"), "b");
  assert.throws(() => v.enum(["a"] as const)("z"), ValidationError);
  assert.equal(v.boolean()("true"), true);
  assert.deepEqual(v.array(v.string())(["x", "y"]), ["x", "y"]);
  assert.throws(() => v.array(v.string(), { max: 1 })(["x", "y"]), ValidationError);
  assert.throws(() => v.array(v.number())([1, "two"]), ValidationError); // bad element
});

test("object validator: required, optional, drops unknown keys, aggregates issues", () => {
  const schema = v.object({ name: v.string({ min: 1 }), age: v.optional(v.number({ int: true })) });
  assert.deepEqual(schema({ name: "Ada", age: 30, extra: "dropped" }), { name: "Ada", age: 30 });
  assert.deepEqual(schema({ name: "Ada" }), { name: "Ada", age: undefined });
  try { schema({ name: "", age: 1.5 }); assert.fail("should throw"); }
  catch (e) { assert.ok(e instanceof ValidationError && e.issues.length === 2); } // both fields reported
});

test("parseOr400 returns the value on success and 400s on failure", () => {
  const schema = v.object({ q: v.string({ min: 1 }) });
  // success
  const okReq = { body: { q: "hi" } } as never;
  const okRes = { status() { throw new Error("should not 400"); } } as never;
  assert.deepEqual(parseOr400(okReq, okRes, schema), { q: "hi" });
  // failure → 400 with issues, returns null
  let code = 0; let payload: unknown;
  const badReq = { body: { q: "" } } as never;
  const badRes = { status(c: number) { code = c; return { json(p: unknown) { payload = p; } }; } } as never;
  assert.equal(parseOr400(badReq, badRes, schema), null);
  assert.equal(code, 400);
  assert.match(JSON.stringify(payload), /invalid request/);
});
