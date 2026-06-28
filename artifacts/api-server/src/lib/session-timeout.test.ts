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

test("defaults are 30m idle and 8h absolute", () => {
  assert.equal(idleMs(), 30 * 60_000);
  assert.equal(absoluteMs(), 8 * 60 * 60_000);
});

test("a fresh session is not expired", () => {
  const now = Date.now();
  assert.equal(isSessionExpired({ ...base, iat: now, seen: now }, now), false);
});

test("idle timeout expires a session inactive past the limit", () => {
  const now = Date.now();
  assert.equal(isSessionExpired({ ...base, iat: now, seen: now - 31 * 60_000 }, now), true);
  assert.equal(isSessionExpired({ ...base, iat: now, seen: now - 29 * 60_000 }, now), false);
});

test("absolute cap expires an old session even if recently active", () => {
  const now = Date.now();
  assert.equal(isSessionExpired({ ...base, iat: now - 9 * 60 * 60_000, seen: now }, now), true);
});

test("missing timestamps are lenient (pre-upgrade cookies survive)", () => {
  assert.equal(isSessionExpired({ ...base }, Date.now()), false);
});

test("SESSION_IDLE_MINUTES=0 disables the idle timeout", () => {
  process.env["SESSION_IDLE_MINUTES"] = "0";
  const now = Date.now();
  assert.equal(isSessionExpired({ ...base, iat: now, seen: now - 999 * 60_000 }, now), false);
});
