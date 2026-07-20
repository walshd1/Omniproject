import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Whiteboard LIVE-CURSOR relay routes over the REAL app (roadmap 2.3). A `board:<id>` room over the same
 * generic in-memory relay the wiki co-edit uses — transient cursor fan-out, nothing stored. The sender's
 * identity (label + colour) is stamped server-side, so a client can't spoof another person; only the
 * position is client-supplied. Read/broadcast is viewer+ (seeing/sharing a cursor is not authoring); a
 * project board's cursor room is scope-guarded like every other project-scoped room.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["ENABLED_FEATURES"] = "whiteboard";
process.env["SECURITY_STRICT"] = "off";

let server: Server;
let base: string;

function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const ADMIN = cookie({ sub: "u-ad", name: "Ada Min", email: "ada@x.io", roles: ["omni-admins"] });

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

const post = (roomId: string, body: unknown, c = ADMIN) =>
  fetch(`${base}/api/whiteboards/rooms/${encodeURIComponent(roomId)}`, {
    method: "POST", headers: { cookie: c, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

test("relay requires a cid", async () => {
  assert.equal((await post("board:user~b1", { msg: { x: 1, y: 2 } })).status, 400);
});

test("GET stream without a cid is a 400", async () => {
  const r = await fetch(`${base}/api/whiteboards/rooms/${encodeURIComponent("board:user~b1")}/stream`, { headers: { cookie: ADMIN } });
  assert.equal(r.status, 400);
  await r.body?.cancel().catch(() => {});
});

test("an oversized cursor payload is refused (413)", async () => {
  assert.equal((await post("board:user~b1", { cid: "a", msg: { note: "x".repeat(2_001) } })).status, 413);
});

test("the stream joins a room and a cursor is fanned out to the OTHER member, identity stamped server-side", async () => {
  const room = "board:org~relay-1";
  const ac = new AbortController();
  const streamRes = await fetch(`${base}/api/whiteboards/rooms/${encodeURIComponent(room)}/stream?cid=b`, { headers: { cookie: ADMIN }, signal: ac.signal });
  assert.equal(streamRes.status, 200);
  assert.match(streamRes.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = streamRes.body!.getReader();
  const decoder = new TextDecoder();

  let buf = "";
  let deadline = Date.now() + 4000;
  while (!buf.includes("event: ready") && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  assert.ok(buf.includes("event: ready"), "stream opens with a ready frame");

  const r = await post(room, { cid: "a", msg: { x: 40, y: 90 } });
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as { delivered: number }).delivered, 1, "delivered to the one other member");

  deadline = Date.now() + 4000;
  while (!buf.includes("event: cursor") && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  assert.ok(buf.includes("event: cursor"), "the peer receives the relayed cursor event");
  assert.ok(buf.includes("\"from\":\"a\""), "carries the sender cid");
  assert.ok(buf.includes("\"x\":40"), "carries the client cursor position");
  assert.ok(buf.includes("\"label\":\"Ada Min\""), "identity (label) is stamped server-side, not from the client");

  ac.abort();
  try { await reader.cancel(); } catch { /* aborted */ }
});

test("a project board's cursor room is scope-guarded: an out-of-scope member is refused (403)", async () => {
  const keys = ["OIDC_ISSUER_URL"] as const;
  const prev = process.env["OIDC_ISSUER_URL"];
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  try {
    const member = cookie({ sub: "m1", email: "m@x.io", roles: ["omni-members"] }); // user-level scope
    const room = "board:project~some-other-teams-project~xyz";
    const stream = await fetch(`${base}/api/whiteboards/rooms/${encodeURIComponent(room)}/stream?cid=c1`, { headers: { cookie: member } });
    assert.equal(stream.status, 403, "cannot join a cursor room for a project outside their scope");
    await stream.body?.cancel().catch(() => {});
    assert.equal((await post(room, { cid: "c1", msg: { x: 1, y: 1 } }, member)).status, 403);
  } finally {
    void keys;
    if (prev === undefined) delete process.env["OIDC_ISSUER_URL"]; else process.env["OIDC_ISSUER_URL"] = prev;
  }
});
