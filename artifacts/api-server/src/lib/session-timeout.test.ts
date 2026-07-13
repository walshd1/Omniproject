import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { isSessionExpired, idleMs, absoluteMs } from "./session-timeout";
import type { Session } from "./oidc";

/**
 * Session timeout policy: sliding idle timeout + absolute lifetime cap, lenient to
 * pre-upgrade cookies, configurable (and disable-able) via env.
 */
const base: Session = { sub: "u1", accessToken: "t" };

afterEach(() => {
  delete process.env["SESSION_IDLE_MINUTES"];
  delete process.env["SESSION_ABSOLUTE_HOURS"];
});

test("defaults are short: 15m idle and 4h absolute (bounds a live-session-piggyback window)", () => {
  assert.equal(idleMs(), 15 * 60_000);
  assert.equal(absoluteMs(), 4 * 60 * 60_000);
});

test("a fresh session is not expired", () => {
  const now = Date.now();
  assert.equal(isSessionExpired({ ...base, iat: now, seen: now }, now), false);
});

test("idle timeout expires a session inactive past the 15m limit", () => {
  const now = Date.now();
  assert.equal(isSessionExpired({ ...base, iat: now, seen: now - 16 * 60_000 }, now), true);
  assert.equal(isSessionExpired({ ...base, iat: now, seen: now - 14 * 60_000 }, now), false);
});

test("absolute cap expires an old session even if recently active (past 4h)", () => {
  const now = Date.now();
  assert.equal(isSessionExpired({ ...base, iat: now - 5 * 60 * 60_000, seen: now }, now), true);
  assert.equal(isSessionExpired({ ...base, iat: now - 3 * 60 * 60_000, seen: now }, now), false);
});

test("missing timestamps are lenient (pre-upgrade cookies survive)", () => {
  assert.equal(isSessionExpired({ ...base }, Date.now()), false);
});

test("SESSION_IDLE_MINUTES=0 disables the idle timeout", () => {
  process.env["SESSION_IDLE_MINUTES"] = "0";
  const now = Date.now();
  assert.equal(isSessionExpired({ ...base, iat: now, seen: now - 999 * 60_000 }, now), false);
});
