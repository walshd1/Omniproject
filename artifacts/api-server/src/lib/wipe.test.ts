import { test } from "node:test";
import assert from "node:assert/strict";
import { wipeInMemoryState } from "./wipe";
import { pushBrokerEvent, brokerLogSize } from "./broker-log";

test("wipeInMemoryState clears the bounded in-memory working sets", () => {
  pushBrokerEvent({ ts: "2026-01-01T00:00:00Z", category: "broker", action: "list_projects", status: 200, ms: 1, result: "success" });
  assert.ok(brokerLogSize() > 0);
  wipeInMemoryState();
  assert.equal(brokerLogSize(), 0); // references dropped, eligible for GC
});

test("wipeInMemoryState is idempotent / safe to call when already empty", () => {
  wipeInMemoryState();
  assert.doesNotThrow(() => wipeInMemoryState());
  assert.equal(brokerLogSize(), 0);
});
