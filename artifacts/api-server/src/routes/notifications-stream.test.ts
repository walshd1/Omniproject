import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { revokedIfDeprovisioned } from "./notifications-stream";
import type { SseStream } from "../lib/sse";
import { createUser, __resetScim } from "../lib/scim";

/**
 * The keepAlive onTick doubles as a live-revocation check: a stream whose principal is
 * deprovisioned mid-connection (SCIM active=false) is torn down at once rather than outliving the
 * revocation until the client reconnects. (The ping + the once-guarded unsubscribe-on-close are the
 * shared keepAlive helper's job — covered in lib/sse.test.ts; here we test only the predicate.)
 */
afterEach(() => {
  delete process.env["SCIM_TOKEN"];
  __resetScim();
});

/** A session-bearing request (legacy plaintext cookie path is accepted by readSession). */
function reqWithSession(session: object): Request {
  return { signedCookies: { omni_session: JSON.stringify(session) }, headers: {} } as unknown as Request;
}

/** A fake SseStream that records the events the predicate emits. */
function fakeStream(): { stream: SseStream; sent: { event: string; data: unknown }[] } {
  const sent: { event: string; data: unknown }[] = [];
  const stream = { send: (event: string, data: unknown) => sent.push({ event, data }), comment: () => {}, close: () => {} };
  return { stream, sent };
}

test("a still-active principal is not revoked and emits nothing (keepAlive writes the ping)", () => {
  const { stream, sent } = fakeStream();
  const revoked = revokedIfDeprovisioned(reqWithSession({ sub: "u1", email: "live@x.io", accessToken: "t" }), stream);
  assert.equal(revoked, false);
  assert.equal(sent.length, 0);
});

test("a deprovisioned principal is revoked with a `revoked` event", () => {
  process.env["SCIM_TOKEN"] = "scim-secret-strong-012345";
  createUser({ userName: "gone@x.io", active: false });
  const { stream, sent } = fakeStream();
  const revoked = revokedIfDeprovisioned(reqWithSession({ sub: "u9", email: "gone@x.io", accessToken: "t" }), stream);
  assert.equal(revoked, true);
  assert.deepEqual(sent, [{ event: "revoked", data: { reason: "deprovisioned" } }]);
});

test("a SCIM-known but still-active principal is not revoked", () => {
  process.env["SCIM_TOKEN"] = "scim-secret-strong-012345";
  createUser({ userName: "ok@x.io", active: true });
  const { stream, sent } = fakeStream();
  assert.equal(revokedIfDeprovisioned(reqWithSession({ sub: "u2", email: "ok@x.io", accessToken: "t" }), stream), false);
  assert.equal(sent.length, 0);
});

test("an unauthenticated stream (no session) is never treated as deprovisioned", () => {
  process.env["SCIM_TOKEN"] = "scim-secret-strong-012345";
  const { stream } = fakeStream();
  assert.equal(revokedIfDeprovisioned({ signedCookies: {}, headers: {} } as unknown as Request, stream), false);
});
