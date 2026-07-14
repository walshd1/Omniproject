import { test } from "node:test";
import assert from "node:assert/strict";
import { wipeInMemoryState } from "./wipe";
import { pushBrokerEvent, brokerLogSize } from "./broker-log";
import { deriveKey, zeroizeKeyCaches } from "./crypto-keys";

test("wipeInMemoryState clears the bounded in-memory working sets", () => {
  pushBrokerEvent({ ts: "2026-01-01T00:00:00Z", category: "broker", action: "list_projects", status: 200, ms: 1, result: "success" });
  assert.ok(brokerLogSize() > 0);
  wipeInMemoryState();
  assert.equal(brokerLogSize(), 0); // references dropped, eligible for GC
});

test("cleanse ACTIVELY zeroises the derived key Buffers (not just drops references)", () => {
  const key = deriveKey("a-high-entropy-secret", "session");
  assert.ok(key.some((b) => b !== 0)); // a real key, not already zero
  const sameRef = deriveKey("a-high-entropy-secret", "session"); // cached ⇒ same Buffer
  assert.equal(sameRef, key);

  wipeInMemoryState(); // includes zeroizeKeyCaches()

  // The bytes of the Buffer we were handed are now scrubbed in place.
  assert.ok(key.every((b) => b === 0), "the derived key Buffer's bytes were overwritten with zeros");
  // The cache was cleared, so a subsequent derivation mints a FRESH Buffer (not the wiped one).
  const fresh = deriveKey("a-high-entropy-secret", "session");
  assert.notEqual(fresh, key);
  assert.ok(fresh.some((b) => b !== 0));
});

test("zeroizeKeyCaches is idempotent / safe on an empty cache", () => {
  zeroizeKeyCaches();
  assert.doesNotThrow(() => zeroizeKeyCaches());
});

test("wipeInMemoryState is idempotent / safe to call when already empty", () => {
  wipeInMemoryState();
  assert.doesNotThrow(() => wipeInMemoryState());
  assert.equal(brokerLogSize(), 0);
});
