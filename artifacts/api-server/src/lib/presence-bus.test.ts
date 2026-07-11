import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PresenceBus } from "./presence-bus";
import { joinRoom, roomSnapshot, _resetPresenceForTest, type PresenceEvent } from "./presence-hub";
import type { MinimalRedis } from "./redis-bus";

/**
 * Presence fan-out over the bus, exercised with a FAKE ioredis double (no live Redis, no network).
 * The three guarantees the fleet path rests on:
 *   1. a LOCAL presence change publishes exactly ONE envelope to the channel;
 *   2. an INBOUND remote envelope updates the local roster and NEVER re-publishes (loop-safe),
 *      and a replica ignores its OWN echo;
 *   3. GHOST peers from a crashed replica expire (covered deterministically in presence-hub.test.ts;
 *      here we prove the wire path folds a remote peer in at all).
 * The real-connect body of initRedis needs the (absent) ioredis dep, so we inject the fake client
 * directly via connectFake — mirroring redis-bus.test.ts.
 */

/** A hand-written ioredis double whose subscriber "message" handler can be triggered via emit(). */
function makeFakeRedis() {
  const log = { publish: [] as Array<[string, string]>, subscribed: [] as string[] };
  let subCb: ((channel: string, message: string) => void) | undefined;
  const mk = (isSub: boolean): MinimalRedis => ({
    async publish(channel, message) { log.publish.push([channel, message]); return 1; },
    async subscribe(channel) { log.subscribed.push(channel); return "OK"; },
    on(_event, cb) { if (isSub) subCb = cb; },
    duplicate() { return mk(true); },
    async quit() { return "OK"; },
  });
  return { client: mk(false), log, emit: (channel: string, message: string) => subCb?.(channel, message) };
}

/** PresenceBus with the Redis-mode wiring simulated via a fake client + a seam onto handleMessage. */
class Probe extends PresenceBus {
  connectFake(pub: MinimalRedis): void {
    const sub = pub.duplicate();
    void sub.subscribe(this.channel);
    sub.on("message", (_c, message) => this.handleMessage(message));
    this.pub = pub;
    this.mode = "redis";
  }
  /** Deliver a raw channel message as if it arrived from another replica. */
  feed(message: string): void { this.handleMessage(message); }
}

interface Wire { from: string; ev: PresenceEvent; }

beforeEach(() => {
  delete process.env["REDIS_URL"];
  _resetPresenceForTest(); // also clears any publisher a prior Probe registered
});

test("no REDIS_URL: bus stays in-process and publishing fans out to nothing (byte-identical default)", async () => {
  const bus = new PresenceBus();
  assert.equal(bus.mode, "in-process");
  // A local join still works locally; the no-op publish must not throw.
  const a = { events: [] as unknown[], send: (e: string, d: unknown) => a.events.push({ e, d }) };
  joinRoom({ roomId: "r1", cid: "a", sub: "u1", label: "Ada", send: a.send }, 0);
  await bus.publish({ kind: "leave", roomId: "r1", cid: "a" });
  assert.equal(roomSnapshot("r1", 0).length, 1); // untouched by the no-op bus
});

test("a local presence change publishes exactly one envelope, tagged with this instanceId", async () => {
  const bus = new Probe();
  const fake = makeFakeRedis();
  bus.connectFake(fake.client);

  const a = { send: (_e: string, _d: unknown) => {} };
  joinRoom({ roomId: "r1", cid: "a", sub: "u1", label: "Ada", send: a.send }, 0);
  await Promise.resolve(); // let the fire-and-forget publisher settle

  assert.equal(fake.log.publish.length, 1);
  const [channel, payload] = fake.log.publish[0]!;
  assert.equal(channel, "omniproject:presence");
  const wire = JSON.parse(payload) as Wire;
  assert.equal(wire.from, bus.instanceId);
  assert.equal(wire.ev.kind, "upsert");
  assert.equal(wire.ev.cid, "a");
  assert.equal(wire.ev.peer?.label, "Ada");
});

test("an inbound remote envelope updates the local roster WITHOUT re-publishing", async () => {
  const bus = new Probe();
  const fake = makeFakeRedis();
  bus.connectFake(fake.client);

  // A local peer so the room has a socket to re-fan to.
  joinRoom({ roomId: "r1", cid: "local", sub: "u1", label: "Ada", send: () => {} }, 0);
  await Promise.resolve();
  const publishedByUs = fake.log.publish.length; // our own join upsert

  const wire: Wire = { from: "some-other-replica", ev: { kind: "upsert", roomId: "r1", cid: "remote", peer: { cid: "remote", sub: "u2", label: "Bo", color: "#000", editing: null, editingAt: 0 } } };
  bus.feed(JSON.stringify(wire));

  assert.equal(roomSnapshot("r1", 0).map((p) => p.cid).sort().join(","), "local,remote");
  assert.equal(fake.log.publish.length, publishedByUs); // folding must NOT put anything on the wire
});

test("loop guard: a replica ignores its OWN echo (same instanceId)", async () => {
  const bus = new Probe();
  const fake = makeFakeRedis();
  bus.connectFake(fake.client);
  joinRoom({ roomId: "r1", cid: "local", sub: "u1", label: "Ada", send: () => {} }, 0);

  const echo: Wire = { from: bus.instanceId, ev: { kind: "upsert", roomId: "r1", cid: "echo", peer: { cid: "echo", sub: "u9", label: "X", color: "#000", editing: null, editingAt: 0 } } };
  bus.feed(JSON.stringify(echo));
  // The echoed peer must NOT appear — we already applied it locally when we published it.
  assert.equal(roomSnapshot("r1", 0).some((p) => p.cid === "echo"), false);
});

test("a malformed bus message is ignored (never throws)", () => {
  const bus = new Probe();
  const fake = makeFakeRedis();
  bus.connectFake(fake.client);
  assert.doesNotThrow(() => bus.feed("{not json"));
  assert.doesNotThrow(() => bus.feed(JSON.stringify({ from: "x" }))); // missing ev
});

test("initPresenceBus is idempotent (single bus per process)", async () => {
  const { initPresenceBus } = await import("./presence-bus");
  assert.equal(initPresenceBus(), initPresenceBus());
});
