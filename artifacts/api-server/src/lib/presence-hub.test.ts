import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  peerColor, toPeer, roomSnapshot, joinRoom, setEditing, presenceStats,
  closeAllPresence, _resetPresenceForTest, LOCK_TTL_MS, type PresencePeer,
} from "./presence-hub";

/**
 * Presence hub — ephemeral, advisory live-collaboration state over SSE. Connections only; no
 * persistence. Field "locks" are soft and TTL'd; the hard guarantee stays Issue.version.
 */

beforeEach(() => _resetPresenceForTest());

/** A no-op sink that records the events a connection is sent. */
function sink() {
  const events: { event: string; data: unknown }[] = [];
  return { send: (event: string, data: unknown) => events.push({ event, data }), events };
}

test("peerColor is deterministic per user and within the palette", () => {
  assert.equal(peerColor("user-a"), peerColor("user-a"));
  assert.match(peerColor("user-a"), /^#[0-9a-f]{6}$/);
});

test("toPeer expires a stale editing claim against now", () => {
  const base: PresencePeer = { cid: "c1", sub: "u1", label: "Ada", color: "#000", editing: "status", editingAt: 1000 };
  assert.equal(toPeer(base, 1000 + LOCK_TTL_MS - 1).editing, "status"); // still fresh
  assert.equal(toPeer(base, 1000 + LOCK_TTL_MS).editing, null);          // expired
});

test("joinRoom adds a peer, broadcasts to the room, and leave removes + re-broadcasts", () => {
  const a = sink();
  const leaveA = joinRoom({ roomId: "r1", cid: "a", sub: "u1", label: "Ada", send: a.send }, 0);
  assert.equal(roomSnapshot("r1", 0).length, 1);
  // A's first event is the snapshot containing itself.
  assert.equal(a.events.at(-1)?.event, "presence");

  const b = sink();
  joinRoom({ roomId: "r1", cid: "b", sub: "u2", label: "Bo", send: b.send }, 0);
  assert.equal(roomSnapshot("r1", 0).length, 2);
  // A was re-broadcast to when B joined.
  const lastToA = a.events.at(-1)?.data as { peers: PresencePeer[] };
  assert.equal(lastToA.peers.length, 2);

  leaveA();
  assert.equal(roomSnapshot("r1", 0).map((p) => p.cid).sort().join(","), "b");
});

test("setEditing records the field and broadcasts; an unknown cid is rejected", () => {
  const a = sink();
  joinRoom({ roomId: "r1", cid: "a", sub: "u1", label: "Ada", send: a.send }, 0);
  assert.equal(setEditing("r1", "a", "priority", 5000), true);
  assert.equal(roomSnapshot("r1", 5000).find((p) => p.cid === "a")?.editing, "priority");
  assert.equal(setEditing("r1", "ghost", "status", 5000), false);
  assert.equal(setEditing("nope", "a", "status", 5000), false);
});

test("a released (null) claim stops showing", () => {
  const a = sink();
  joinRoom({ roomId: "r1", cid: "a", sub: "u1", label: "Ada", send: a.send }, 0);
  setEditing("r1", "a", "status", 1000);
  setEditing("r1", "a", null, 2000);
  assert.equal(roomSnapshot("r1", 2000).find((p) => p.cid === "a")?.editing, null);
});

test("presenceStats counts rooms and connections; closeAllPresence drains them", () => {
  const a = sink(), b = sink();
  joinRoom({ roomId: "r1", cid: "a", sub: "u1", label: "Ada", send: a.send }, 0);
  joinRoom({ roomId: "r2", cid: "b", sub: "u2", label: "Bo", send: b.send, close: () => { /* noop */ } }, 0);
  assert.deepEqual(presenceStats(), { rooms: 2, connections: 2 });
  assert.equal(closeAllPresence(), 2);
  assert.deepEqual(presenceStats(), { rooms: 0, connections: 0 });
});

test("roomSnapshot of an unknown room is empty (idle rooms cost nothing)", () => {
  assert.deepEqual(roomSnapshot("nobody-here", Date.now()), []);
});
