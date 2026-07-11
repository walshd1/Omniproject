// Mount the default-off `comments` feature module for this test process (before the app is imported).
process.env["ENABLED_FEATURES"] = "comments";

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, memberCookie, type Harness } from "./_harness";
import { addClient } from "../lib/notify-hub";
import { sharedKv } from "../lib/shared-state";

/**
 * routes/comments.ts over the REAL app: POST→GET→DELETE round-trip, body validation, and the
 * @mention → notification wiring. (The harness runs demo auth, so the requireRole("contributor")
 * write gate is exercised generically by rbac-enforcement.test.ts, not re-asserted here.)
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => { await sharedKv.clear("comments:"); });

const ROOM = "issue:p1:i1";

test("POST then GET round-trips a comment on a room", async () => {
  const post = await h.req(`/comments/${ROOM}`, { cookie: memberCookie(), method: "POST", body: { body: "hello team" } });
  assert.equal(post.status, 201);
  const { comment } = (await post.json()) as { comment: { id: string; body: string } };
  assert.equal(comment.body, "hello team");

  const get = await h.req(`/comments/${ROOM}`, { cookie: memberCookie() });
  assert.equal(get.status, 200);
  const { comments } = (await get.json()) as { comments: { id: string }[] };
  assert.deepEqual(comments.map((c) => c.id), [comment.id]);
});

test("POST with an empty/whitespace body is rejected 400", async () => {
  const r = await h.req(`/comments/${ROOM}`, { cookie: memberCookie(), method: "POST", body: { body: "   " } });
  assert.equal(r.status, 400);
});

test("an @mention dispatches a mention notification to the mentioned user", async () => {
  const received: { event: string; data: unknown }[] = [];
  const off = addClient({ id: "test-bob", sub: "bob", roles: [], send: (event, data) => received.push({ event, data }) });
  try {
    const r = await h.req(`/comments/${ROOM}`, { cookie: memberCookie(), method: "POST", body: { body: "please review @bob" } });
    assert.equal(r.status, 201);
    await new Promise((res) => setTimeout(res, 25)); // let the fire-and-forget bus publish flush
    const mention = received.find((g) => (g.data as { kind?: string })?.kind === "mention");
    assert.ok(mention, "the mentioned user received a mention notification");
  } finally {
    off();
  }
});

test("DELETE by the author removes the comment; an unknown comment is 404", async () => {
  const post = await h.req(`/comments/${ROOM}`, { cookie: memberCookie(), method: "POST", body: { body: "temp" } });
  const { comment } = (await post.json()) as { comment: { id: string } };

  const del = await h.req(`/comments/${ROOM}/${comment.id}`, { cookie: memberCookie(), method: "DELETE" });
  assert.equal(del.status, 200);
  const { comments } = (await (await h.req(`/comments/${ROOM}`, { cookie: memberCookie() })).json()) as { comments: unknown[] };
  assert.equal(comments.length, 0);

  const missing = await h.req(`/comments/${ROOM}/nope`, { cookie: memberCookie(), method: "DELETE" });
  assert.equal(missing.status, 404);
});
