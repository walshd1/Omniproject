import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Wiki co-edit relay routes over the REAL app: the SSE stream joins a room and receives peers' CRDT
 * messages, and the POST fans a message out to the other members. The server is a dumb relay — it never
 * parses or stores the payload. Co-editing is an authoring act, so both routes are contributor+.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["ENABLED_FEATURES"] = "wikiCoEdit"; // default-off (cost) — opt in for these route tests
process.env["SECURITY_STRICT"] = "off";

let server: Server;
let base: string;

function signedSessionCookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const EDITOR = signedSessionCookie({ sub: "u-ed", name: "Ed Itor", email: "ed@x.io", roles: ["omni-admins"] });

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

const post = (roomId: string, body: unknown, cookie = EDITOR) =>
  fetch(`${base}/api/collab/rooms/${roomId}`, {
    method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

test("POST relay requires a cid", async () => {
  const r = await post("doc:d1", { msg: { t: "update", u: "AA==" } });
  assert.equal(r.status, 400);
});

test("GET stream without a cid is a 400", async () => {
  const r = await fetch(`${base}/api/collab/rooms/doc:d1/stream`, { headers: { cookie: EDITOR } });
  assert.equal(r.status, 400);
  await r.body?.cancel().catch(() => {});
});

test("an oversized relay payload is refused (413)", async () => {
  const r = await post("doc:d1", { cid: "a", msg: { t: "update", u: "x".repeat(200_001) } });
  assert.equal(r.status, 413);
});

test("the stream joins a room and the POST fans a message out to the OTHER member", async () => {
  const room = "doc:relay-1";
  const ac = new AbortController();
  const streamRes = await fetch(`${base}/api/collab/rooms/${room}/stream?cid=b`, { headers: { cookie: EDITOR }, signal: ac.signal });
  assert.equal(streamRes.status, 200);
  assert.match(streamRes.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = streamRes.body!.getReader();
  const decoder = new TextDecoder();

  // Wait for the ready frame so the join is registered before we relay.
  let buf = "";
  let deadline = Date.now() + 4000;
  while (!buf.includes("event: ready") && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  assert.ok(buf.includes("event: ready"), "stream opens with a ready frame");

  // Another member (cid "a") relays a CRDT update; the server fans it to "b".
  const r = await post(room, { cid: "a", msg: { t: "update", u: "AQID" } });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { ok: boolean; delivered: number };
  assert.equal(body.delivered, 1, "delivered to the one other member");

  // The open stream receives the relayed frame verbatim (from + msg), not its own.
  deadline = Date.now() + 4000;
  while (!buf.includes("event: collab") && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  assert.ok(buf.includes("event: collab"), "the peer receives the relayed collab event");
  assert.ok(buf.includes("\"from\":\"a\""), "the frame carries the sender cid");
  assert.ok(buf.includes("\"u\":\"AQID\""), "the frame carries the opaque CRDT payload");

  ac.abort();
  try { await reader.cancel(); } catch { /* aborted */ }
});

// ── RBAC: co-editing is contributor+ (a viewer may read the saved doc, not the live edit stream) ──
function withViewerRbac(fn: () => Promise<void>): Promise<void> {
  const keys = ["OIDC_ISSUER_URL", "OIDC_VIEWER_ROLES", "OIDC_CONTRIBUTOR_ROLES"] as const;
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_VIEWER_ROLES"] = "omni-viewers";
  process.env["OIDC_CONTRIBUTOR_ROLES"] = "omni-contributors";
  return (async () => { try { await fn(); } finally {
    for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]!; }
  } })();
}

test("a viewer is refused the co-edit stream AND relay (403)", async () => {
  await withViewerRbac(async () => {
    const viewer = signedSessionCookie({ sub: "v1", email: "vee@x.io", roles: ["omni-viewers"] });
    const stream = await fetch(`${base}/api/collab/rooms/doc:d9/stream?cid=c1`, { headers: { cookie: viewer } });
    assert.equal(stream.status, 403);
    await stream.body?.cancel().catch(() => {});
    const relay = await post("doc:d9", { cid: "c1", msg: { t: "update", u: "AA==" } }, viewer);
    assert.equal(relay.status, 403);
  });
});
