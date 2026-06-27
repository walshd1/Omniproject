import { test } from "node:test";
import assert from "node:assert/strict";
import { isDevMode, devModeStatus } from "./dev-mode";

/**
 * Dev-mode gating. The production-inert assertions are the CI guard: a released
 * build can never present as a dev instance or expose the dev surfaces.
 */

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test("CI guard: dev mode is always off in production, regardless of flags", () => {
  withEnv({ NODE_ENV: "production", OMNI_DEV_MODE: "1", BROKER_TRACE: "1", BROKER_CAPTURE: "/t.jsonl" }, () => {
    assert.equal(isDevMode(), false);
    const s = devModeStatus();
    assert.equal(s.devMode, false);
    assert.deepEqual(s.surfaces, { persist: false, trace: false, capture: false });
  });
});

test("dev mode activates on the explicit master switch (non-prod)", () => {
  withEnv({ NODE_ENV: "development", OMNI_DEV_MODE: "1", BROKER_TRACE: undefined, BROKER_CAPTURE: undefined }, () => {
    assert.equal(isDevMode(), true);
  });
});

test("dev mode activates when any debug surface is armed (non-prod)", () => {
  withEnv({ NODE_ENV: "development", OMNI_DEV_MODE: undefined, BROKER_TRACE: "1", BROKER_CAPTURE: undefined }, () => {
    assert.equal(isDevMode(), true);
    assert.equal(devModeStatus().surfaces.trace, true);
  });
  withEnv({ NODE_ENV: "development", OMNI_DEV_MODE: undefined, BROKER_TRACE: undefined, BROKER_CAPTURE: "/t.jsonl" }, () => {
    assert.equal(isDevMode(), true);
    assert.equal(devModeStatus().surfaces.capture, true);
  });
});

test("dev mode is off on a clean non-prod build with nothing armed", () => {
  withEnv({ NODE_ENV: "development", OMNI_DEV_MODE: undefined, BROKER_TRACE: undefined, BROKER_CAPTURE: undefined }, () => {
    assert.equal(isDevMode(), false);
  });
});

test("status carries no paths or secrets — only booleans + env label", () => {
  withEnv({ NODE_ENV: "test", OMNI_DEV_MODE: "1", BROKER_CAPTURE: "/secret/path.jsonl" }, () => {
    const s = devModeStatus();
    assert.equal(s.env, "test");
    assert.ok(!JSON.stringify(s).includes("/secret/path"));
  });
});
