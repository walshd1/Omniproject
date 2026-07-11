import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { addComment, listComments, getComment, deleteComment, parseMentions } from "./comments";
import { sharedKv } from "./shared-state";

/**
 * Comment threads over the ephemeral shared-state seam: add/list/delete, @mention parsing, room
 * isolation, stable ordering. No broker, no server — just the in-memory sharedKv.
 */
afterEach(async () => { await sharedKv.clear("comments:"); });

const author = { sub: "u-alice", label: "Alice" };

test("parseMentions extracts @tokens, dedupes, and ignores emails", () => {
  assert.deepEqual(parseMentions("hi @bob and @carol"), ["bob", "carol"]);
  assert.deepEqual(parseMentions("@bob @bob @bob"), ["bob"]); // deduped
  assert.deepEqual(parseMentions("ping me at alice@example.com please"), []); // email @ is not a mention
  assert.deepEqual(parseMentions("start @lead, mid-word x@y, end @tail"), ["lead", "tail"]);
  assert.deepEqual(parseMentions("no mentions here"), []);
});

test("addComment stores a comment with id, author, parsed mentions and timestamp", async () => {
  const c = await addComment("issue:p1:i1", author, "look @bob", 1_700_000_000_000);
  assert.ok(c.id);
  assert.equal(c.roomId, "issue:p1:i1");
  assert.deepEqual(c.author, author);
  assert.deepEqual(c.mentions, ["bob"]);
  assert.equal(c.createdAt, new Date(1_700_000_000_000).toISOString());
  assert.equal((await getComment("issue:p1:i1", c.id))?.body, "look @bob");
});

test("listComments returns a room's thread oldest-first", async () => {
  await addComment("issue:p1:i1", author, "first", 1000);
  await addComment("issue:p1:i1", author, "second", 2000);
  await addComment("issue:p1:i1", author, "third", 3000);
  const thread = await listComments("issue:p1:i1");
  assert.deepEqual(thread.map((c) => c.body), ["first", "second", "third"]);
});

test("rooms are isolated — a comment in one room never appears in another", async () => {
  await addComment("issue:p1:i1", author, "in room A", 1000);
  await addComment("project:p2", author, "in room B", 1000);
  assert.deepEqual((await listComments("issue:p1:i1")).map((c) => c.body), ["in room A"]);
  assert.deepEqual((await listComments("project:p2")).map((c) => c.body), ["in room B"]);
});

test("deleteComment removes a comment and returns it; deleting a missing one returns null", async () => {
  const c = await addComment("issue:p1:i1", author, "temp", 1000);
  const deleted = await deleteComment("issue:p1:i1", c.id);
  assert.equal(deleted?.id, c.id);
  assert.equal(await getComment("issue:p1:i1", c.id), null);
  assert.equal(await deleteComment("issue:p1:i1", "does-not-exist"), null);
  assert.deepEqual(await listComments("issue:p1:i1"), []);
});
