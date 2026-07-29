import { test } from "node:test";
import assert from "node:assert/strict";
import { projectIdOfRoom } from "./room-scope";

/**
 * The realtime routes (comments/attachments/presence/collab) share an in-memory hub keyed only by roomId,
 * so `projectIdOfRoom` is the single point that decides whether a room carries a project boundary the route
 * must enforce. This is the regression guard for the fail-open where a project wiki doc's `doc:project~…`
 * room resolved to `null` (unguarded) — leaking its comments/attachments/presence/co-edit to out-of-scope
 * principals — because the old helper recognized only literal `issue:`/`project:` first segments.
 */

test("issue:/project: rooms resolve their projectId (unchanged)", () => {
  assert.equal(projectIdOfRoom("issue:P1:i9"), "P1");
  assert.equal(projectIdOfRoom("project:P2"), "P2");
});

test("a project-storage doc room IS scoped (the fixed fail-open)", () => {
  // A project wiki doc's id is `project~<projectId>~<localId>`; its room is `doc:<that id>`.
  assert.equal(projectIdOfRoom("doc:project~P1~1e6b9c2d-uuid"), "P1");
  // The board namespace shares the same self-describing id shape (whiteboard cursors via the collab hub).
  assert.equal(projectIdOfRoom("board:project~P2~aa11-uuid"), "P2");
});

test("user/org/sidecar doc rooms stay UNSCOPED (org-content collaboration, no regression)", () => {
  assert.equal(projectIdOfRoom("doc:user~abc-uuid"), null);
  assert.equal(projectIdOfRoom("doc:org~abc-uuid"), null);
  assert.equal(projectIdOfRoom("doc:sidecar~abc-uuid"), null);
  assert.equal(projectIdOfRoom("board:user~abc-uuid"), null);
});

test("malformed / unknown-prefix rooms resolve to null (no accidental scoping)", () => {
  assert.equal(projectIdOfRoom(""), null);
  assert.equal(projectIdOfRoom("nocolon"), null);
  assert.equal(projectIdOfRoom("doc:"), null);
  assert.equal(projectIdOfRoom("doc:garbage"), null); // not a valid scoped id
  assert.equal(projectIdOfRoom("whiteboard:project~P1~x"), null); // unrecognized kind
});
