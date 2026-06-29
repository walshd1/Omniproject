import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";

// REDIS_URL is set but neither 'rate-limit-redis' nor 'ioredis' is installed, so
// the shared-store upgrade must fail gracefully and leave per-replica limiting in
// place (limits still enforced, just not globally) — never crash the limiter.
process.env["REDIS_URL"] = "redis://127.0.0.1:6379";
// A low login ceiling so the brute-force test fires only a handful of requests.
process.env["AUTH_RATE_LIMIT_MAX"] = "5";

const { apiLimiter, analyticsLimiter, loginLimiter, rateLimitMode } = await import("./rate-limit");

test("rate limit falls back to per-replica when the Redis store deps are absent", async () => {
  // Give the fire-and-forget initRedisStore a tick to resolve its (failing) imports.
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(rateLimitMode(), "in-process");
});

test("the exported limiters are stable, callable middleware regardless of store", () => {
  assert.equal(typeof apiLimiter, "function");
  assert.equal(typeof analyticsLimiter, "function");
  assert.equal(typeof loginLimiter, "function");
});

test("loginLimiter returns 429 once the per-IP login ceiling is exceeded", async () => {
  const app = express();
  app.get("/login", loginLimiter, (_req, res) => res.status(200).send("ok"));
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  try {
    const codes: number[] = [];
    // AUTH_RATE_LIMIT_MAX=5 → the first 5 pass, the 6th is throttled.
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/login`);
      codes.push(res.status);
      await res.text();
    }
    assert.deepEqual(codes.slice(0, 5), [200, 200, 200, 200, 200]);
    assert.equal(codes[5], 429);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
