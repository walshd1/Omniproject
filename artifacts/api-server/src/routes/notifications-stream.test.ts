import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { sseKeepaliveTick } from "./notifications-stream";
import { createUser, __resetScim } from "../lib/scim";

/**
 * The SSE keepalive tick doubles as a live-revocation check: a stream whose principal
 * is deprovisioned mid-connection (SCIM active=false) is torn down at once rather than
 * outliving the revocation until the client happens to reconnect.
 */
afterEach(() => {
  delete process.env["SCIM_TOKEN"];
  __resetScim();
});

/** A session-bearing request (legacy plaintext cookie path is accepted by readSession). */
function reqWithSession(session: object): Request {
  return { signedCookies: { omni_session: JSON.stringify(session) }, headers: {} } as unknown as Request;
}

interface Captured { res: Response; writes: string[]; ended: () => boolean }
function capturingRes(): Captured {
  const writes: string[] = [];
  let ended = false;
  const res = {
    write(chunk: string) { writes.push(chunk); return true; },
    end() { ended = true; return this; },
  } as unknown as Response;
  return { res, writes, ended: () => ended };
}

test("a still-active stream gets a keepalive ping and stays open", () => {
  const cap = capturingRes();
  const closed = sseKeepaliveTick(reqWithSession({ sub: "u1", email: "live@x.io", accessToken: "t" }), cap.res);
  assert.equal(closed, false);
  assert.equal(cap.ended(), false);
  assert.ok(cap.writes.some((w) => w.includes(": ping")));
});

test("a deprovisioned principal's stream is closed with a revoked event", () => {
  process.env["SCIM_TOKEN"] = "scim-secret";
  createUser({ userName: "gone@x.io", active: false });
  const cap = capturingRes();
  const closed = sseKeepaliveTick(reqWithSession({ sub: "u9", email: "gone@x.io", accessToken: "t" }), cap.res);
  assert.equal(closed, true);
  assert.equal(cap.ended(), true);
  assert.ok(cap.writes.some((w) => w.includes("event: revoked") && w.includes("deprovisioned")));
});

test("a SCIM-known but still-active principal is not closed", () => {
  process.env["SCIM_TOKEN"] = "scim-secret";
  createUser({ userName: "ok@x.io", active: true });
  const cap = capturingRes();
  const closed = sseKeepaliveTick(reqWithSession({ sub: "u2", email: "ok@x.io", accessToken: "t" }), cap.res);
  assert.equal(closed, false);
  assert.equal(cap.ended(), false);
});

test("an unauthenticated stream (no session) is never treated as deprovisioned", () => {
  process.env["SCIM_TOKEN"] = "scim-secret";
  const cap = capturingRes();
  const closed = sseKeepaliveTick({ signedCookies: {}, headers: {} } as unknown as Request, cap.res);
  assert.equal(closed, false);
});
