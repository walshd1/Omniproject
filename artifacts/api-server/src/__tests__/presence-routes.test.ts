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

let server: Server;
let base: string;

function signedSessionCookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const USER = signedSessionCookie({ sub: "u-pres", name: "Ada Lovelace", email: "ada@x.io", roles: ["omni-admins"] });

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
