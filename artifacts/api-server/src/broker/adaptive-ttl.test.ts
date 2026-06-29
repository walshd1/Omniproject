import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { adaptiveTtl, recordLatency, methodLatency, adaptiveStats, resetAdaptive } from "./adaptive-ttl";

/**
 * Latency-aware TTL (combined model): baseline until measured, 0 below the threshold (already fast),
 * else clamp(MIN, MAX, factor × latency). Inert unless READ_CACHE_ADAPTIVE is on.
 */

const ENV = ["READ_CACHE_ADAPTIVE", "READ_CACHE_ADAPTIVE_THRESHOLD_MS", "READ_CACHE_ADAPTIVE_FACTOR", "READ_CACHE_MIN_TTL_MS", "READ_CACHE_MAX_TTL_MS"];

beforeEach(() => {
  resetAdaptive();
  for (const k of ENV) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

const BASE = 3000;

test("adaptive off ⇒ the baseline TTL is used unchanged", () => {
  recordLatency("listIssues", 900);
  assert.equal(adaptiveTtl("listIssues", BASE), BASE);
});

test("cold start (no measurement) falls back to the baseline", () => {
  process.env["READ_CACHE_ADAPTIVE"] = "true";
  assert.equal(adaptiveTtl("listIssues", BASE), BASE);
});

test("an already-fast method (below threshold) is not cached", () => {
  process.env["READ_CACHE_ADAPTIVE"] = "true";
  process.env["READ_CACHE_ADAPTIVE_THRESHOLD_MS"] = "150";
  recordLatency("listProjects", 40);
  assert.equal(adaptiveTtl("listProjects", BASE), 0);
});

test("a slow method caches longer — factor × latency, within the clamp", () => {
  process.env["READ_CACHE_ADAPTIVE"] = "true";
  process.env["READ_CACHE_ADAPTIVE_FACTOR"] = "6";
  process.env["READ_CACHE_MIN_TTL_MS"] = "1000";
  process.env["READ_CACHE_MAX_TTL_MS"] = "60000";
  recordLatency("portfolioHealth", 800); // 6 × 800 = 4800, within [1000, 60000]
  assert.equal(adaptiveTtl("portfolioHealth", BASE), 4800);
});

test("the MAX clamp is the staleness ceiling", () => {
  process.env["READ_CACHE_ADAPTIVE"] = "true";
  process.env["READ_CACHE_ADAPTIVE_FACTOR"] = "6";
  process.env["READ_CACHE_MAX_TTL_MS"] = "5000";
  recordLatency("portfolioHealth", 3000); // 6 × 3000 = 18000 → clamped to 5000
  assert.equal(adaptiveTtl("portfolioHealth", BASE), 5000);
});

test("the MIN clamp floors a just-over-threshold method", () => {
  process.env["READ_CACHE_ADAPTIVE"] = "true";
  process.env["READ_CACHE_ADAPTIVE_THRESHOLD_MS"] = "150";
  process.env["READ_CACHE_ADAPTIVE_FACTOR"] = "2";
  process.env["READ_CACHE_MIN_TTL_MS"] = "1000";
  recordLatency("listIssues", 200); // over threshold; 2 × 200 = 400 → floored to 1000
  assert.equal(adaptiveTtl("listIssues", BASE), 1000);
});

test("the EWMA smooths successive samples (newest weighted, not a hard replace)", () => {
  recordLatency("m", 100);
  recordLatency("m", 1100);
  const lat = methodLatency("m")!;
  assert.ok(lat > 100 && lat < 1100, `EWMA between samples, got ${lat}`);
  assert.equal(Math.round(lat), 400); // 0.3×1100 + 0.7×100
});

test("adaptiveStats reports config + per-method latency and chosen TTL", () => {
  process.env["READ_CACHE_ADAPTIVE"] = "true";
  process.env["READ_CACHE_ADAPTIVE_FACTOR"] = "6";
  recordLatency("portfolioHealth", 800);
  const s = adaptiveStats(BASE);
  assert.equal(s.enabled, true);
  assert.equal(s.methods["portfolioHealth"]?.ewmaMs, 800);
  assert.equal(s.methods["portfolioHealth"]?.ttlMs, 4800);
});
