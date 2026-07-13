import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateFleetReadiness } from "./fleet-readiness";

/**
 * Fail-closed-at-scale readiness. When no shared state is declared (no REDIS_URL) the replica is
 * always fleet-ready — single-replica is per-process by design. When REDIS_URL IS declared, the
 * replica is only ready once BOTH shared state and rate limiting are actually Redis-backed; a silent
 * fallback to per-replica (client missing / Redis unreachable) makes it NOT ready so the LB routes
 * elsewhere instead of serving degraded security.
 */

test("no REDIS_URL declared ⇒ always fleet-ready (single-replica, per-process by design)", () => {
  const r = evaluateFleetReadiness({ redisConfigured: false, sharedState: "in-process", rateLimit: "in-process" });
  assert.equal(r.ready, true);
  assert.equal(r.detail, undefined);
});

test("REDIS_URL declared AND both backends Redis ⇒ ready", () => {
  const r = evaluateFleetReadiness({ redisConfigured: true, sharedState: "redis", rateLimit: "redis" });
  assert.equal(r.ready, true);
});

test("REDIS_URL declared but shared-state still per-replica ⇒ NOT ready (fail-closed)", () => {
  const r = evaluateFleetReadiness({ redisConfigured: true, sharedState: "in-process", rateLimit: "redis" });
  assert.equal(r.ready, false);
  assert.match(r.detail!, /shared-state/);
  assert.match(r.detail!, /WITH_REDIS/);
});

test("REDIS_URL declared but rate-limit still per-replica ⇒ NOT ready", () => {
  const r = evaluateFleetReadiness({ redisConfigured: true, sharedState: "redis", rateLimit: "in-process" });
  assert.equal(r.ready, false);
  assert.match(r.detail!, /rate-limit/);
});

test("REDIS_URL declared but NEITHER backend came up ⇒ NOT ready, names both", () => {
  const r = evaluateFleetReadiness({ redisConfigured: true, sharedState: "in-process", rateLimit: "in-process" });
  assert.equal(r.ready, false);
  assert.match(r.detail!, /shared-state \+ rate-limit are still per-replica/);
});
