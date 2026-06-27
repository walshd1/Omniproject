import { test } from "node:test";
import assert from "node:assert/strict";

// REDIS_URL is set but neither 'rate-limit-redis' nor 'ioredis' is installed, so
// the shared-store upgrade must fail gracefully and leave per-replica limiting in
// place (limits still enforced, just not globally) — never crash the limiter.
process.env["REDIS_URL"] = "redis://127.0.0.1:6379";

const { apiLimiter, analyticsLimiter, rateLimitMode } = await import("./rate-limit");

test("rate limit falls back to per-replica when the Redis store deps are absent", async () => {
  // Give the fire-and-forget initRedisStore a tick to resolve its (failing) imports.
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(rateLimitMode(), "in-process");
});

test("the exported limiters are stable, callable middleware regardless of store", () => {
  assert.equal(typeof apiLimiter, "function");
  assert.equal(typeof analyticsLimiter, "function");
});
