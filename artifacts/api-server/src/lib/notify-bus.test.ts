import { test } from "node:test";
import assert from "node:assert/strict";

// Set REDIS_URL BEFORE the bus singleton is constructed, so we exercise the
// initRedis path. ioredis isn't installed, so it logs once and falls back to the
// in-process fan-out — the default-but-graceful behaviour.
process.env["REDIS_URL"] = "redis://127.0.0.1:6379";

const { getNotifyBus, busMode, clientCount } = await import("./notify-bus");

test("notify bus falls back to in-process when ioredis isn't installed", async () => {
  const bus = getNotifyBus();
  // publish() awaits the (failed) Redis init, then delivers locally.
  const delivered = await bus.publish({ notification: { id: "n1", title: "hi" } });
  assert.equal(typeof delivered, "number"); // local delivery count (0 with no SSE clients)
  assert.equal(busMode(), "in-process");
  assert.equal(typeof clientCount(), "number");
});

test("publish tolerates a targeted envelope", async () => {
  const n = await getNotifyBus().publish({ notification: { id: "n2" }, target: { sub: "u1" } });
  assert.equal(typeof n, "number");
});
