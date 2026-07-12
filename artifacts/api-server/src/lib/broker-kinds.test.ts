import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBrokerKinds, BrokerKindsError } from "./broker-kinds";

test("accepts known catalogue broker kinds, normalising (trim, lowercase, dedupe)", () => {
  assert.deepEqual(validateBrokerKinds([" N8N ", "make", "make", ""]), ["n8n", "make"]);
  assert.deepEqual(validateBrokerKinds([]), []);
});

test("rejects an unknown broker kind with a clear error", () => {
  assert.throws(
    () => validateBrokerKinds(["n8n", "totally-not-a-broker"]),
    (e: unknown) => e instanceof BrokerKindsError && /unknown broker kind/.test((e as Error).message),
  );
});

test("rejects a non-array and non-string entries", () => {
  assert.throws(() => validateBrokerKinds({} as unknown), BrokerKindsError);
  assert.throws(() => validateBrokerKinds([123] as unknown), BrokerKindsError);
});
