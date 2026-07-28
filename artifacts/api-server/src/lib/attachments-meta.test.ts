import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  addAttachment,
  listAttachments,
  getAttachment,
  deleteAttachment,
  newStorageKey,
  type AttachmentInput,
} from "./attachments-meta";
import { sharedKv } from "./shared-state";

/**
 * Attachment pointers over the ephemeral shared-state seam: add/list/get/delete, room isolation, newest-
 * first ordering, and that NO bytes are held (only the pointer). No broker, no server — just sharedKv.
 */
afterEach(async () => { await sharedKv.clear("attachments:"); });

const author = { sub: "u-alice", label: "Alice" };
function input(over: Partial<AttachmentInput> = {}): AttachmentInput {
  return { filename: "spec.pdf", contentType: "application/pdf", size: 1234, sha256: "a".repeat(64), storageKey: newStorageKey(), ...over };
}

test("newStorageKey is a flat hex token the sidecar will accept", () => {
  assert.match(newStorageKey(), /^[a-f0-9]{32}$/);
  assert.notEqual(newStorageKey(), newStorageKey()); // unique
});

test("addAttachment stores a byte-free pointer with id, author and timestamp", async () => {
  const a = await addAttachment("issue:p1:i1", input({ filename: "a b.png", contentType: "image/png", size: 9 }), author, 1_700_000_000_000);
  assert.ok(a.id);
  assert.equal(a.roomId, "issue:p1:i1");
  assert.equal(a.filename, "a b.png");
  assert.equal(a.size, 9);
  assert.deepEqual(a.author, author);
  assert.equal(a.createdAt, new Date(1_700_000_000_000).toISOString());
  // Round-trips through the store; the raw value carries no byte field.
  const raw = await sharedKv.get(`attachments:issue:p1:i1:${a.id}`);
  assert.ok(raw && !/"bytes"|"data"|"blob"/.test(raw));
});

test("listAttachments returns a room's pointers newest-first", async () => {
  await addAttachment("issue:p1:i1", input({ filename: "old" }), author, 1000);
  await addAttachment("issue:p1:i1", input({ filename: "mid" }), author, 2000);
  await addAttachment("issue:p1:i1", input({ filename: "new" }), author, 3000);
  assert.deepEqual((await listAttachments("issue:p1:i1")).map((a) => a.filename), ["new", "mid", "old"]);
});

test("rooms are isolated", async () => {
  await addAttachment("issue:p1:i1", input({ filename: "A" }), author, 1000);
  await addAttachment("project:p2", input({ filename: "B" }), author, 1000);
  assert.deepEqual((await listAttachments("issue:p1:i1")).map((a) => a.filename), ["A"]);
  assert.deepEqual((await listAttachments("project:p2")).map((a) => a.filename), ["B"]);
});

test("deleteAttachment removes the pointer and returns it (so the route can drop the bytes)", async () => {
  const a = await addAttachment("issue:p1:i1", input(), author, 1000);
  const deleted = await deleteAttachment("issue:p1:i1", a.id);
  assert.equal(deleted?.id, a.id);
  assert.equal(deleted?.storageKey, a.storageKey);
  assert.equal(await getAttachment("issue:p1:i1", a.id), null);
  assert.equal(await deleteAttachment("issue:p1:i1", "missing"), null);
});
