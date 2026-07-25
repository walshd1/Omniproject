import { test } from "node:test";
import assert from "node:assert/strict";
import { configureServerTimeouts, type TimeoutTarget } from "./server-timeouts";

/** Inbound HTTP hardening (slowloris). Pure — asserted on a structural target, no real server needed. */

test("defaults: request/headers/keepAlive tightened; maxConnections left unset (opt-in)", () => {
  const s: TimeoutTarget = {};
  configureServerTimeouts(s, {});
  assert.equal(s.requestTimeout, 30_000);
  assert.equal(s.headersTimeout, 15_000);
  assert.equal(s.keepAliveTimeout, 10_000);
  assert.equal(s.maxConnections, undefined);
});

test("headersTimeout >= keepAliveTimeout at defaults (no premature 502 behind a keep-alive proxy)", () => {
  const s: TimeoutTarget = {};
  configureServerTimeouts(s, {});
  assert.ok((s.headersTimeout ?? 0) >= (s.keepAliveTimeout ?? 0));
});

test("env overrides apply, and MAX_CONNECTIONS opts in the connection cap", () => {
  const s: TimeoutTarget = {};
  configureServerTimeouts(s, {
    REQUEST_TIMEOUT_MS: "5000",
    HEADERS_TIMEOUT_MS: "2000",
    KEEPALIVE_TIMEOUT_MS: "1000",
    MAX_CONNECTIONS: "500",
  });
  assert.equal(s.requestTimeout, 5000);
  assert.equal(s.headersTimeout, 2000);
  assert.equal(s.keepAliveTimeout, 1000);
  assert.equal(s.maxConnections, 500);
});

test("garbage / non-positive env falls back to the safe default; MAX_CONNECTIONS=0 stays unset", () => {
  const s: TimeoutTarget = {};
  configureServerTimeouts(s, { REQUEST_TIMEOUT_MS: "-1", HEADERS_TIMEOUT_MS: "abc", MAX_CONNECTIONS: "0" });
  assert.equal(s.requestTimeout, 30_000);
  assert.equal(s.headersTimeout, 15_000);
  assert.equal(s.maxConnections, undefined);
});
