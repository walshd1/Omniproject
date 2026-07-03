import { test } from "node:test";
import assert from "node:assert/strict";
import { safeParseJson, stripDangerousKeys } from "./safe-json";

test("parses valid JSON like JSON.parse", () => {
  assert.deepEqual(safeParseJson('{"a":1,"b":[2,3],"c":"x"}'), { a: 1, b: [2, 3], c: "x" });
  assert.equal(safeParseJson("42"), 42);
});

test("throws on invalid JSON", () => {
  assert.throws(() => safeParseJson("{not json}"));
});

test("strips a top-level __proto__ so a later merge cannot pollute Object.prototype", () => {
  const parsed = safeParseJson<Record<string, unknown>>('{"__proto__":{"polluted":true},"ok":1}');
  const merged = { ...parsed };
  assert.equal((merged as Record<string, unknown>)["polluted"], undefined);
  assert.equal(({} as Record<string, unknown>)["polluted"], undefined); // global prototype clean
  assert.equal(parsed["ok"], 1);
});

test("strips nested constructor/prototype keys at any depth (own props removed)", () => {
  const parsed = safeParseJson<Record<string, unknown>>('{"a":{"constructor":{"prototype":{"x":1}}},"b":2}');
  const a = parsed["a"] as Record<string, unknown>;
  assert.equal(Object.prototype.hasOwnProperty.call(a, "constructor"), false);
  assert.deepEqual(Object.keys(a), []); // the malicious constructor key is gone
  assert.equal(parsed["b"], 2);
});

test("does not pollute via the classic attack payload", () => {
  safeParseJson('{"__proto__":{"isAdmin":true}}');
  assert.equal(({} as Record<string, unknown>)["isAdmin"], undefined);
});

test("stripDangerousKeys is a drop-in JSON.parse reviver (usable directly, e.g. by express.json)", () => {
  const parsed = JSON.parse('{"__proto__":{"polluted":true},"ok":1}', stripDangerousKeys) as Record<string, unknown>;
  assert.equal(parsed["polluted"], undefined);
  assert.equal(parsed["ok"], 1);
  assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
});
