import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  captureVersion,
  storeView,
  storeViewShared,
  sharedVersionHistory,
  __resetConfigStore,
} from "./config-store";
import { __resetConfigCrypto } from "./config-crypto";
import { sharedKv, __resetSharedStateForTest, __setRedisKvForTest } from "./shared-state";
import { FakeRedis } from "../__tests__/fake-redis";

/**
 * config-store version history is fleet-consistent when Redis-backed (versions mirrored into the
 * shared ring); local RAM/SealedFile history otherwise. Default (no Redis) is unchanged — the
 * sync API and its tests (config-store.test.ts) are untouched.
 */
afterEach(async () => {
  __resetConfigStore();
  __resetConfigCrypto();
  await sharedKv.clear();
  __resetSharedStateForTest();
});

test("no Redis: sharedVersionHistory == the local history (newest first)", async () => {
  captureVersion("local-change");
  const fleet = await sharedVersionHistory();
  const local = storeView().versions;
  assert.deepEqual(fleet, local);
  assert.equal(fleet[0]!.label, "local-change");
});

test("no Redis: storeViewShared is identical to storeView", async () => {
  captureVersion("x");
  assert.deepEqual(await storeViewShared(), storeView());
});

test("redis mode: captured versions are mirrored to the shared ring (fleet-consistent history)", async () => {
  __setRedisKvForTest(new FakeRedis()); // bind BEFORE first store touch so the seed mirrors too
  captureVersion("v-a");
  captureVersion("v-b");
  await new Promise((r) => setTimeout(r, 20)); // let the best-effort mirrors settle

  const fleet = await sharedVersionHistory();
  const labels = fleet.map((v) => v.label);
  // Newest first, and the fleet view carries every RECORDED capture. (The one-time "initial"
  // seed is pushed directly, before any mirror, so it lives only in the local history.)
  assert.equal(fleet[0]!.label, "v-b");
  assert.ok(labels.includes("v-a"));

  const view = await storeViewShared();
  assert.equal(view.versions[0]!.label, "v-b");
  assert.equal(view.activeEnv, "production");
});
