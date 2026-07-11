import { test } from "node:test";
import assert from "node:assert/strict";
import { RedisBus, type MinimalRedis, type RedisBusNotes } from "./redis-bus";

/**
 * The shared Redis Pub/Sub base. `ioredis` is a runtime-optional dependency and is NOT
 * installed here, so the constructor's real-connect path can't be driven directly. Two
 * honest techniques are used instead:
 *
 *  1. Missing-dep / fallback (REAL): set REDIS_URL and construct a bus. The runtime-dynamic
 *     `import("ioredis")` genuinely resolves to null, so the missingDep branch runs and the
 *     bus stays in-process — a true test of the graceful-degradation path.
 *  2. Redis-live branches (FAKE client): a concrete {@link FakeBus} subclass injects a
 *     hand-written {@link MinimalRedis} double so `broadcast()`'s Redis publish branch and
 *     the subscriber fan-out (on "message" → handleMessage) run with a controllable client —
 *     no network, fully hermetic.
 *
 * The successful real-connect body of `initRedis` (`new Redis()` / duplicate / subscribe /
 * `mode="redis"`) and the constructor's fallback `.catch` only execute when a real ioredis
 * import succeeds and then connects, so they are out of reach without the dep and are left
 * uncovered by design.
 */

const NOTES: RedisBusNotes = {
  missingDep: "test bus: REDIS_URL set but ioredis missing — in-process",
  fallback: "test bus: Redis unavailable — falling back",
  enabled: "test bus: Redis fan-out enabled",
};

const CHANNEL = "test:channel";

/** A hand-written ioredis double. `duplicate()` returns a distinct subscriber whose
 *  registered "message" handler can be triggered via {@link emit}. */
function makeFakeRedis() {
  const log = {
    publish: [] as Array<[string, string]>,
    subscribed: [] as string[],
    onEvents: [] as string[],
    duplicated: 0,
    quit: 0,
  };
  let subCb: ((channel: string, message: string) => void) | undefined;
  const mk = (isSub: boolean): MinimalRedis => ({
    async publish(channel, message) {
      log.publish.push([channel, message]);
      return 1;
    },
    async subscribe(channel) {
      log.subscribed.push(channel);
      return "OK";
    },
    on(event, cb) {
      log.onEvents.push(event);
      if (isSub) subCb = cb;
    },
    duplicate() {
      log.duplicated++;
      return mk(true);
    },
    async quit() {
      log.quit++;
      return "OK";
    },
  });
  return { client: mk(false), log, emit: (channel: string, message: string) => subCb?.(channel, message) };
}

/** Concrete RedisBus that records handled messages and exposes the protected seams. */
class FakeBus extends RedisBus {
  readonly received: string[] = [];

  constructor() {
    super(CHANNEL, NOTES);
  }

  protected handleMessage(message: string): void {
    this.received.push(message);
  }

  /** Await the constructor's readiness promise (null when no REDIS_URL). */
  whenReady(): Promise<void> | null {
    return this.ready;
  }

  /** Override the readiness promise to gate broadcast() in a test. */
  gate(promise: Promise<void> | null): void {
    this.ready = promise;
  }

  /** Expose the protected broadcast() to the test. */
  send(message: string): Promise<boolean> {
    return this.broadcast(message);
  }

  /** Simulate the state `initRedis` sets up on a successful real connect, but with a
   *  fake client — mirrors the real wiring (duplicate → subscribe → on("message")). */
  connectFake(pub: MinimalRedis): void {
    const sub = pub.duplicate();
    void sub.subscribe(this.channel);
    sub.on("message", (_channel, message) => this.handleMessage(message));
    this.pub = pub;
    this.mode = "redis";
  }
}

test("no REDIS_URL: stays in-process, has no readiness promise, and broadcast is a no-op", async () => {
  delete process.env["REDIS_URL"];
  const bus = new FakeBus();
  assert.equal(bus.mode, "in-process");
  assert.equal(bus.whenReady(), null);
  // In-process mode: nothing goes to Redis, so the caller is told to deliver locally.
  assert.equal(await bus.send("hello"), false);
});

test("REDIS_URL set but ioredis absent: logs missingDep and stays in-process", async () => {
  process.env["REDIS_URL"] = "redis://127.0.0.1:6379";
  try {
    const bus = new FakeBus();
    // The constructor kicked off initRedis(); await it. The dynamic ioredis import
    // genuinely fails, so we take the missingDep branch and stay in-process.
    const ready = bus.whenReady();
    assert.notEqual(ready, null);
    await ready;
    assert.equal(bus.mode, "in-process");
    // broadcast() still awaits `ready` first, then returns false (nothing published).
    assert.equal(await bus.send("hello"), false);
  } finally {
    delete process.env["REDIS_URL"];
  }
});

test("Redis mode: broadcast publishes to the channel and reports it went to Redis", async () => {
  delete process.env["REDIS_URL"];
  const bus = new FakeBus();
  const fake = makeFakeRedis();
  bus.connectFake(fake.client);
  assert.equal(bus.mode, "redis");

  const went = await bus.send("payload-1");
  assert.equal(went, true); // true → the caller must NOT also deliver locally
  assert.deepEqual(fake.log.publish, [[CHANNEL, "payload-1"]]);
});

test("Redis mode: an inbound channel message is fanned out to handleMessage", async () => {
  delete process.env["REDIS_URL"];
  const bus = new FakeBus();
  const fake = makeFakeRedis();
  bus.connectFake(fake.client);

  // Wiring assertions: a duplicated subscriber subscribed to the channel and listens for "message".
  assert.equal(fake.log.duplicated, 1);
  assert.deepEqual(fake.log.subscribed, [CHANNEL]);
  assert.deepEqual(fake.log.onEvents, ["message"]);

  // A message arriving from another replica is handed to handleMessage.
  fake.emit(CHANNEL, "from-another-replica");
  fake.emit(CHANNEL, "second");
  assert.deepEqual(bus.received, ["from-another-replica", "second"]);
});

test("Redis mode with a slow readiness promise: broadcast awaits it before publishing", async () => {
  delete process.env["REDIS_URL"];
  const bus = new FakeBus();
  const fake = makeFakeRedis();
  // Put the bus into redis mode but gate it behind a not-yet-resolved readiness promise,
  // exercising the `if (this.ready) await this.ready` branch on the Redis path.
  bus.connectFake(fake.client);
  let release: () => void = () => {};
  bus.gate(
    new Promise<void>((r) => {
      release = r;
    }),
  );
  const pending = bus.send("gated");
  assert.deepEqual(fake.log.publish, []); // nothing published until readiness resolves
  release();
  assert.equal(await pending, true);
  assert.deepEqual(fake.log.publish, [[CHANNEL, "gated"]]);
});
