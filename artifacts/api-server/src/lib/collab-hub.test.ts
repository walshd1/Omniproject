import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  joinCollabRoom, relayToRoom, collabRoomSize, collabConnectionCount, _resetCollabForTest,
} from "./collab-hub";

/** The dumb co-edit relay hub: rooms, fan-out to others, leave/cleanup, per-principal accounting. */
afterEach(() => _resetCollabForTest());

/** A fake connection that records the events it receives. */
function conn(roomId: string, cid: string, sub: string) {
  const got: Array<{ event: string; data: unknown }> = [];
  return { roomId, cid, sub, send: (event: string, data: unknown) => got.push({ event, data }), got };
}

test("relays a message to the other members of a room but not the sender", () => {
  const a = conn("doc:d1", "a", "u1");
  const b = conn("doc:d1", "b", "u2");
  const c = conn("doc:d1", "c", "u3");
  joinCollabRoom(a); joinCollabRoom(b); joinCollabRoom(c);
  assert.equal(collabRoomSize("doc:d1"), 3);

  const delivered = relayToRoom("doc:d1", "a", "collab", { from: "a", msg: { t: "update", u: "AA==" } });
  assert.equal(delivered, 2, "delivered to the two non-senders");
  assert.equal(a.got.length, 0, "sender does not receive its own message");
  assert.deepEqual(b.got[0], { event: "collab", data: { from: "a", msg: { t: "update", u: "AA==" } } });
  assert.deepEqual(c.got[0]!.data, { from: "a", msg: { t: "update", u: "AA==" } });
});

test("does not cross rooms", () => {
  const a = conn("doc:d1", "a", "u1");
  const b = conn("doc:d2", "b", "u2");
  joinCollabRoom(a); joinCollabRoom(b);
  assert.equal(relayToRoom("doc:d1", "a", "collab", { x: 1 }), 0, "no other member in room d1");
  assert.equal(b.got.length, 0, "member of d2 is untouched");
});

test("leaving removes the connection and drops an empty room", () => {
  const a = conn("doc:d1", "a", "u1");
  const b = conn("doc:d1", "b", "u2");
  const leaveA = joinCollabRoom(a);
  const leaveB = joinCollabRoom(b);
  leaveA();
  assert.equal(collabRoomSize("doc:d1"), 1);
  assert.equal(relayToRoom("doc:d1", "z", "collab", {}), 1, "only b remains");
  leaveB();
  assert.equal(collabRoomSize("doc:d1"), 0, "room dropped when empty");
});

test("counts concurrent streams per principal across rooms", () => {
  joinCollabRoom(conn("doc:d1", "a", "u1"));
  joinCollabRoom(conn("doc:d2", "b", "u1"));
  joinCollabRoom(conn("doc:d1", "c", "u2"));
  assert.equal(collabConnectionCount("u1"), 2);
  assert.equal(collabConnectionCount("u2"), 1);
  assert.equal(collabConnectionCount("nobody"), 0);
});
