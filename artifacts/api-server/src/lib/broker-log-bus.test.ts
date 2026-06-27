import { test } from "node:test";
import assert from "node:assert/strict";

// Set REDIS_URL BEFORE the bus is constructed so we exercise the initRedis path.
// ioredis isn't installed, so it logs once and falls back to per-replica fan-out
// — the default-but-graceful behaviour.
process.env["REDIS_URL"] = "redis://127.0.0.1:6379";

const { initBrokerLogBus, brokerLogBusMode } = await import("./broker-log-bus");
const { pushBrokerEvent, clearBrokerLog, brokerLogSize } = await import("./broker-log");

test("broker-log bus falls back to in-process when ioredis isn't installed", async () => {
  const bus = initBrokerLogBus();
  await bus.publish({ ts: "2026-01-01T00:00:00Z", action: "list_projects", result: "success", status: 200, ms: 1, projectId: null, actor: null, note: null, replica: "test" });
  assert.equal(brokerLogBusMode(), "in-process");
});

test("with the bus active, pushBrokerEvent still records locally (publisher is a safe no-op)", () => {
  clearBrokerLog();
  initBrokerLogBus(); // registers its publisher
  pushBrokerEvent({ ts: "2026-01-01T00:00:00Z", category: "broker", action: "list_issues", status: 200, ms: 3, result: "success" });
  // In-process mode the publisher fans out to nothing; local recording is unaffected.
  assert.equal(brokerLogSize(), 1);
});

test("initBrokerLogBus is idempotent (single bus per process)", () => {
  assert.equal(initBrokerLogBus(), initBrokerLogBus());
});
