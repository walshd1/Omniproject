import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Presence routes over the REAL app: the SSE stream registers a connection, and the POST heartbeat
 * sets an advisory editing claim that the room snapshot then reflects. Ephemeral, advisory only.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
// presence is default-off (cost: SSE streams) in the gating model — opt it in for these route tests.
process.env["ENABLED_FEATURES"] = "presence";
// This "production" is a test-harness convenience flag, not a real deployment: no OIDC is
// configured (demo auth) and rate-limiting is deliberately off, both of which are now CRITICAL
// boot-refusing findings by default. Opt out for this harness only.
process.env["SECURITY_STRICT"] = "off";

let server: Server;
let base: string;

function signedSessionCookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const USER = signedSessionCookie({ sub: "u-pres", name: "Ada Lovelace", email: "ada@x.io", roles: ["omni-admins"] });
// A session with no display name → the room label must fall back to the email.
const NAMELESS = signedSessionCookie({ sub: "u-anon", email: "anon@x.io", roles: ["omni-admins"] });

/** Open an SSE stream and wait for the first presence snapshot so the connection is registered. */
async function openStream(room: string, cid: string, cookie: string): Promise<{ abort: () => void }> {
  const ac = new AbortController();
  const res = await fetch(`${base}/api/presence/rooms/${room}/stream?cid=${cid}`, { headers: { cookie }, signal: ac.signal });
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + 4000;
  while (!buf.includes("event: presence") && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  assert.ok(buf.includes("event: presence"), "stream should emit a presence snapshot on join");
  return { abort: () => { ac.abort(); reader.cancel().catch(() => {}); } };
}

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

const post = (roomId: string, body: unknown) =>
  fetch(`${base}/api/presence/rooms/${roomId}`, {
    method: "POST",
    headers: { cookie: USER, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("POST presence requires a cid", async () => {
  const r = await post("issue:p1:i1", { editing: "status" });
  assert.equal(r.status, 400);
});

test("POST for an unknown connection is rejected (open the stream first)", async () => {
  const r = await post("issue:p1:i1", { cid: "never-opened", editing: "status" });
  assert.equal(r.status, 409);
});

test("the stream registers a connection; a heartbeat sets the advisory editing claim", async () => {
  const cid = "c-test-1";
  const room = "issue:p9:i9";
  const ac = new AbortController();
  const streamRes = await fetch(`${base}/api/presence/rooms/${room}/stream?cid=${cid}`, {
    headers: { cookie: USER },
    signal: ac.signal,
  });
  assert.equal(streamRes.status, 200);
  assert.match(streamRes.headers.get("content-type") ?? "", /text\/event-stream/);

  // Read frames until the first "presence" snapshot confirms our join landed.
  const reader = streamRes.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + 4000;
  while (!buf.includes("event: presence") && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  assert.ok(buf.includes("event: presence"), "stream should emit a presence snapshot on join");

  // Now claim a field; the POST response echoes the room snapshot with our editing claim + identity.
  const r = await post(room, { cid, editing: "status" });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { ok: boolean; peers: { cid: string; label: string; editing: string | null }[] };
  const me = body.peers.find((p) => p.cid === cid);
  assert.ok(me, "snapshot should include our connection");
  assert.equal(me!.editing, "status");
  assert.equal(me!.label, "Ada Lovelace"); // identity from the session

  ac.abort();
  try { await reader.cancel(); } catch { /* aborted */ }
});

test("GET stream without a cid is a 400", async () => {
  const r = await fetch(`${base}/api/presence/rooms/issue:p1:i1/stream`, { headers: { cookie: USER } });
  assert.equal(r.status, 400);
  const body = (await r.json()) as { error: string };
  assert.match(body.error, /roomId and cid are required/);
});

test("editing:null releases a previously-claimed field", async () => {
  const cid = "c-release";
  const room = "issue:p2:i2";
  const stream = await openStream(room, cid, USER);
  try {
    await post(room, { cid, editing: "title" });
    const r = await post(room, { cid, editing: null });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { peers: { cid: string; editing: string | null }[] };
    assert.equal(body.peers.find((p) => p.cid === cid)!.editing, null);
  } finally {
    stream.abort();
  }
});

// ── IDOR guard: a project-scoped room is scope-checked (guardRoomScope) ─────────
// A room id encodes a projectId (issue:<projectId>:<issueId> / project:<projectId>); the presence hub
// is keyed only by roomId, so without the guard any authenticated principal could join another
// tenant's room. Demo auth grants all-scope (the tests above pass any room), so the negative path
// needs REAL RBAC: a user-scoped member naming a project it can't see must be refused BEFORE the SSE
// opens / the heartbeat lands. Mirrors the comments-module room guard over the identical id format.
const MEMBER = signedSessionCookie({ sub: "u-mem", email: "mem@x.io", roles: ["omni-users"] });

async function withRealRbac(fn: () => Promise<void>): Promise<void> {
  const keys = ["OIDC_ISSUER_URL", "OIDC_ADMIN_ROLES", "OIDC_PMO_ROLES"] as const;
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_ADMIN_ROLES"] = "omni-admins";
  process.env["OIDC_PMO_ROLES"] = "omni-pmo";
  try { await fn(); } finally {
    for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
}

test("presence room: a scoped principal is refused a room for an out-of-scope project (403), stream AND heartbeat", async () => {
  await withRealRbac(async () => {
    const room = "issue:some-other-teams-project:i1";
    // GET stream → 403 JSON (guard runs before openSse, so it's a normal error, not an SSE body).
    const stream = await fetch(`${base}/api/presence/rooms/${room}/stream?cid=c1`, { headers: { cookie: MEMBER } });
    assert.equal(stream.status, 403);
    await stream.body?.cancel().catch(() => {});
    // POST heartbeat → 403 before setEditing touches the hub.
    const beat = await fetch(`${base}/api/presence/rooms/${room}`, {
      method: "POST", headers: { cookie: MEMBER, "Content-Type": "application/json" },
      body: JSON.stringify({ cid: "c1", editing: "status" }),
    });
    assert.equal(beat.status, 403);
  });
});

test("presence room: a portfolio-scoped principal (PMO) is not blocked by the room guard", async () => {
  await withRealRbac(async () => {
    const PMO = signedSessionCookie({ sub: "u-pmo", name: "Pat", email: "pat@x.io", roles: ["omni-pmo"], amr: ["hwk"] });
    // all-scope ⇒ the guard passes; a POST for an unopened connection reaches the 409 (not a 403).
    const beat = await fetch(`${base}/api/presence/rooms/project:any-project`, {
      method: "POST", headers: { cookie: PMO, "Content-Type": "application/json" },
      body: JSON.stringify({ cid: "never-opened", editing: "status" }),
    });
    assert.notEqual(beat.status, 403);
  });
});

test("a nameless session's presence label falls back to the email", async () => {
  const cid = "c-nameless";
  const room = "issue:p3:i3";
  const stream = await openStream(room, cid, NAMELESS);
  try {
    const r = await post(room, { cid, editing: "status" });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { peers: { cid: string; label: string }[] };
    assert.equal(body.peers.find((p) => p.cid === cid)!.label, "anon@x.io");
  } finally {
    stream.abort();
  }
});
