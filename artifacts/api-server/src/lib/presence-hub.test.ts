import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  peerColor, toPeer, roomSnapshot, joinRoom, setEditing, presenceStats,
  closeAllPresence, _resetPresenceForTest, foldRemotePresence, localPresenceForHeartbeat,
  registerPresencePublisher, LOCK_TTL_MS, PEER_TTL_MS, type PresencePeer, type PresenceEvent,
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

// --- Fleet-awareness (opt-in): remote peers folded from the presence bus. Deterministic `now`. ---

/** Build a publishable peer upsert for a remote replica's peer. */
function remoteUpsert(roomId: string, peer: Partial<PresencePeer> & { cid: string }): PresenceEvent {
  return {
    kind: "upsert", roomId, cid: peer.cid,
    peer: { cid: peer.cid, sub: peer.sub ?? peer.cid, label: peer.label ?? peer.cid, color: peer.color ?? "#000", editing: peer.editing ?? null, editingAt: peer.editingAt ?? 0 },
  };
}

test("a local mutation publishes exactly one event to a registered publisher", () => {
  const seen: PresenceEvent[] = [];
  registerPresencePublisher((ev) => seen.push(ev));
  const a = sink();
  const leave = joinRoom({ roomId: "r1", cid: "a", sub: "u1", label: "Ada", send: a.send }, 0);
  assert.deepEqual(seen.map((e) => e.kind), ["upsert"]);      // join → 1 upsert
  setEditing("r1", "a", "status", 1000);
  assert.deepEqual(seen.map((e) => e.kind), ["upsert", "upsert"]); // editing-change → 1 more
  leave();
  assert.deepEqual(seen.map((e) => e.kind), ["upsert", "upsert", "leave"]); // leave → 1 leave
  assert.equal(seen.at(-1)?.cid, "a");
});

test("foldRemotePresence merges a remote peer into the roster and re-fans to local sockets", () => {
  const a = sink();
  joinRoom({ roomId: "r1", cid: "a", sub: "u1", label: "Ada", send: a.send }, 0);
  const before = a.events.length;
  foldRemotePresence(remoteUpsert("r1", { cid: "b", label: "Bo" }), 0);
  // The local roster now shows both peers…
  assert.equal(roomSnapshot("r1", 0).map((p) => p.cid).sort().join(","), "a,b");
  // …and the local socket was re-broadcast the merged snapshot (no re-publish involved).
  assert.equal(a.events.length, before + 1);
  const last = a.events.at(-1)?.data as { peers: PresencePeer[] };
  assert.equal(last.peers.length, 2);
});

test("foldRemotePresence does NOT re-publish (loop-safe): folding fires no publisher", () => {
  const seen: PresenceEvent[] = [];
  registerPresencePublisher((ev) => seen.push(ev));
  foldRemotePresence(remoteUpsert("r1", { cid: "b" }), 0);
  assert.deepEqual(seen, []); // a folded remote event must never bounce back onto the bus
});

test("a remote leave removes the remote peer from the roster", () => {
  foldRemotePresence(remoteUpsert("r1", { cid: "b" }), 0);
  assert.equal(roomSnapshot("r1", 0).length, 1);
  foldRemotePresence({ kind: "leave", roomId: "r1", cid: "b" }, 0);
  assert.equal(roomSnapshot("r1", 0).length, 0);
});

test("a remote editing claim is carried and expires against the local clock", () => {
  foldRemotePresence(remoteUpsert("r1", { cid: "b", editing: "status", editingAt: 1000 }), 1000);
  assert.equal(roomSnapshot("r1", 1000 + LOCK_TTL_MS - 1).find((p) => p.cid === "b")?.editing, "status");
  assert.equal(roomSnapshot("r1", 1000 + LOCK_TTL_MS).find((p) => p.cid === "b")?.editing, null);
});

test("ghost expiry: a remote peer past PEER_TTL_MS is dropped and pruned (crashed-replica ghosts)", () => {
  foldRemotePresence(remoteUpsert("r1", { cid: "b" }), 1000);
  assert.equal(roomSnapshot("r1", 1000 + PEER_TTL_MS - 1).length, 1); // still alive
  assert.equal(roomSnapshot("r1", 1000 + PEER_TTL_MS).length, 0);     // ghost reaped
  // Pruned, not merely filtered: a later read at the same idle room stays empty and cheap.
  assert.deepEqual(roomSnapshot("r1", 1000 + PEER_TTL_MS + 5), []);
});

test("a fresh remote event refreshes lastSeen so a live-but-idle peer is not ghosted", () => {
  foldRemotePresence(remoteUpsert("r1", { cid: "b" }), 1000);
  foldRemotePresence(remoteUpsert("r1", { cid: "b" }), 1000 + PEER_TTL_MS - 1); // heartbeat
  assert.equal(roomSnapshot("r1", 1000 + PEER_TTL_MS + 1).length, 1); // survived because refreshed
});

test("a local connection wins over a same-cid remote (the socket is the truth)", () => {
  const a = sink();
  joinRoom({ roomId: "r1", cid: "dup", sub: "u1", label: "Local", send: a.send }, 0);
  foldRemotePresence(remoteUpsert("r1", { cid: "dup", label: "Remote" }), 0);
  const peers = roomSnapshot("r1", 0);
  assert.equal(peers.length, 1);
  assert.equal(peers[0]?.label, "Local");
});

test("localPresenceForHeartbeat lists every live local peer as an upsert (fleet heartbeat source)", () => {
  const a = sink(), b = sink();
  joinRoom({ roomId: "r1", cid: "a", sub: "u1", label: "Ada", send: a.send }, 0);
  joinRoom({ roomId: "r2", cid: "b", sub: "u2", label: "Bo", send: b.send }, 0);
  const beats = localPresenceForHeartbeat();
  assert.equal(beats.length, 2);
  assert.ok(beats.every((e) => e.kind === "upsert" && e.peer));
  assert.equal(beats.map((e) => e.cid).sort().join(","), "a,b");
});
