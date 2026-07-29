import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, memberCookie, type Harness } from "./_harness";
import { __resetSessionRegistry } from "../lib/session-registry";

/**
 * routes/auth.ts device & active-session inventory over the REAL app. A session is recorded in the
 * directory (lib/session-registry) on the authenticated read path, keyed by its per-session `salt`, and
 * surfaced to its owner by a non-reversible handle. Proves: the list flags the current session and never
 * leaks the raw salt; revoking a device signs THAT session out (it reads as 401 next request) without
 * touching siblings; "sign out others" keeps the current one; revoking the current session is a logout.
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); });
beforeEach(() => { __resetSessionRegistry(); }); // isolate the process-global directory per test

// A member session pinned to a specific per-session salt (so it lands in the directory under a known id).
const dev = (salt: string) => memberCookie({ salt });
const get = (path: string, cookie: string) => h.req(path, { cookie });
const revoke = (cookie: string, body: unknown) => h.req("/auth/sessions/revoke", { method: "POST", cookie, body });

test("lists the caller's sessions, flags the current one, and never exposes the raw salt", async () => {
  const res = await get("/auth/sessions", dev("salt-current"));
  assert.equal(res.status, 200);
  const { sessions } = (await res.json()) as { sessions: { id: string; current: boolean; firstSeen: number; lastSeen: number }[] };
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]!.current, true);
  assert.match(sessions[0]!.id, /^[0-9a-f]{16}$/); // a 16-hex handle, not the salt
  assert.notEqual(sessions[0]!.id, "salt-current");
  assert.ok(sessions[0]!.firstSeen > 0 && sessions[0]!.lastSeen > 0);
});

test("a second device shows up; revoking it signs THAT session out and leaves the current one", async () => {
  // Touch the app from two devices so both are recorded (GET /auth/sessions is an authenticated read).
  await get("/auth/sessions", dev("salt-a")); // "current" device
  await get("/auth/sessions", dev("salt-b")); // the other device
  const listed = await (await get("/auth/sessions", dev("salt-a"))).json() as { sessions: { id: string; current: boolean }[] };
  assert.equal(listed.sessions.length, 2);
  const other = listed.sessions.find((s) => !s.current)!;
  assert.ok(other);

  // Revoke the OTHER device from the current one.
  const r = await revoke(dev("salt-a"), { id: other.id });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, current: false });

  // The revoked device now reads as signed-out (GET /auth/sessions 401s); the current device is unaffected.
  assert.equal((await get("/auth/sessions", dev("salt-b"))).status, 401);
  const after = await (await get("/auth/sessions", dev("salt-a"))).json() as { sessions: { current: boolean }[] };
  assert.equal(after.sessions.length, 1);
  assert.equal(after.sessions[0]!.current, true);
});

test("{ others: true } signs out every OTHER device, keeping the current session", async () => {
  await get("/auth/sessions", dev("salt-a"));
  await get("/auth/sessions", dev("salt-b"));
  await get("/auth/sessions", dev("salt-c"));
  const r = await revoke(dev("salt-a"), { others: true });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, revoked: 2 });
  assert.equal((await get("/auth/sessions", dev("salt-b"))).status, 401);
  assert.equal((await get("/auth/sessions", dev("salt-c"))).status, 401);
  assert.equal((await get("/auth/sessions", dev("salt-a"))).status, 200); // current survives
});

test("revoking your OWN current session behaves like a logout", async () => {
  const listed = await (await get("/auth/sessions", dev("salt-self"))).json() as { sessions: { id: string; current: boolean }[] };
  const self = listed.sessions[0]!;
  const r = await revoke(dev("salt-self"), { id: self.id });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, current: true });
  // The session is now revoked — the same cookie reads as signed-out.
  assert.equal((await get("/auth/sessions", dev("salt-self"))).status, 401);
});

test("revoke needs an id or { others: true }, and an unknown id is a 404", async () => {
  await get("/auth/sessions", dev("salt-x"));
  assert.equal((await revoke(dev("salt-x"), {})).status, 400);
  assert.equal((await revoke(dev("salt-x"), { id: "deadbeefdeadbeef" })).status, 404);
});

test("an unauthenticated caller gets 401 from both endpoints", async () => {
  assert.equal((await h.req("/auth/sessions")).status, 401);
  assert.equal((await h.req("/auth/sessions/revoke", { method: "POST", body: { others: true } })).status, 401);
});
