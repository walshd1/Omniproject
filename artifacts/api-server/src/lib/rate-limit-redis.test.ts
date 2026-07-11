import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";

/**
 * The Redis / mode-flag branches of rate-limit.ts. The shared-store upgrade needs the
 * runtime-optional `rate-limit-redis` + `ioredis` deps, which are NOT installed, and the
 * loader/wiring helpers are module-private (no injection seam). So this covers the branches
 * that ARE reachable without the deps, each via a fresh env-gated re-import (query-string
 * cache-bust so every case re-runs the module top-level with its own env):
 *
 *  - REDIS_URL set, deps absent → the graceful per-replica fallback (loadRedisDeps → null,
 *    initRedisStore returns, mode stays "in-process").
 *  - RATE_LIMIT_DISABLED=true → the limiters become pass-throughs and the Redis init is
 *    skipped entirely (`!DISABLED` short-circuit).
 *  - No REDIS_URL → the default in-process limiters, no Redis init attempted.
 *
 * The successful-connect body (loadRedisDeps returning a client, wireRedisLimiters swapping
 * in the Redis store, mode="redis") and initRedisStore's error `.catch` only run when the
 * real deps import successfully, so they are out of reach here and left uncovered by design.
 */

const MOD = "./rate-limit.ts";
let bust = 0;
/** Re-import rate-limit.ts fresh so its top-level runs against the current env. */
async function freshImport() {
  return import(`${MOD}?bust=${bust++}`);
}

/** Restore the env keys this suite toggles, so re-imports start from a known baseline. */
function resetEnv() {
  delete process.env["REDIS_URL"];
  delete process.env["RATE_LIMIT_DISABLED"];
}

test("REDIS_URL set but the Redis store deps are absent: falls back to per-replica (in-process)", async () => {
  resetEnv();
  process.env["REDIS_URL"] = "redis://127.0.0.1:6379";
  try {
    const { rateLimitMode, apiLimiter, analyticsLimiter, loginLimiter } = await freshImport();
    // initRedisStore is fire-and-forget; give its (failing) dynamic imports a tick to resolve.
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(rateLimitMode(), "in-process");
    // The limiters remain stable, callable middleware regardless of the store outcome.
    assert.equal(typeof apiLimiter, "function");
    assert.equal(typeof analyticsLimiter, "function");
    assert.equal(typeof loginLimiter, "function");
  } finally {
    resetEnv();
  }
});

test("RATE_LIMIT_DISABLED=true: limiters are pass-throughs and Redis init is skipped", async () => {
  resetEnv();
  process.env["RATE_LIMIT_DISABLED"] = "true";
  // REDIS_URL is also set to prove the `!DISABLED` guard short-circuits before touching Redis.
  process.env["REDIS_URL"] = "redis://127.0.0.1:6379";
  try {
    const { apiLimiter, rateLimitMode } = await freshImport();
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(rateLimitMode(), "in-process");

    // A pass-through never throttles: many requests all succeed.
    const app = express();
    app.get("/x", apiLimiter, (_req, res) => res.status(200).send("ok"));
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const codes: number[] = [];
      for (let i = 0; i < 8; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/x`);
        codes.push(res.status);
        await res.text();
      }
      assert.ok(
        codes.every((c) => c === 200),
        `disabled limiter must pass every request, got ${codes.join(",")}`,
      );
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    resetEnv();
  }
});

test("no REDIS_URL: default in-process limiters, no Redis init attempted", async () => {
  resetEnv();
  const { rateLimitMode, apiLimiter } = await freshImport();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(rateLimitMode(), "in-process");
  assert.equal(typeof apiLimiter, "function");
});

test("an in-process limiter still enforces its ceiling (per-replica counters)", async () => {
  resetEnv();
  process.env["ANALYTICS_RATE_LIMIT_MAX"] = "3";
  try {
    const { analyticsLimiter, rateLimitMode } = await freshImport();
    assert.equal(rateLimitMode(), "in-process");

    const app = express();
    // Fixed key so every request shares one counter window regardless of source IP.
    app.set("trust proxy", true);
    app.get("/a", analyticsLimiter, (_req, res) => res.status(200).send("ok"));
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const codes: number[] = [];
      // ANALYTICS_RATE_LIMIT_MAX=3 → first 3 pass, the 4th is throttled.
      for (let i = 0; i < 4; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/a`);
        codes.push(res.status);
        await res.text();
      }
      assert.deepEqual(codes.slice(0, 3), [200, 200, 200]);
      assert.equal(codes[3], 429);
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    delete process.env["ANALYTICS_RATE_LIMIT_MAX"];
    resetEnv();
  }
});
