import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit tests for the real-time notification fan-out: the connection hub
 * (lib/notify-hub) and the in-process bus (lib/notify-bus). REDIS_URL is left
 * unset, so the bus runs in-process and publish() delivers to locally-connected
 * clients synchronously — no Redis, no network.
 */
const { addClient, clientCount, clientMatches, deliverLocal } = await import("../lib/notify-hub");
const { getNotifyBus, busMode } = await import("../lib/notify-bus");

interface Received {
  event: string;
  data: unknown;
}

function fakeClient(over: Partial<{ sub: string; email: string; roles: string[] }> = {}) {
  const received: Received[] = [];
  const client = {
    id: `c-${Math.random()}`,
    sub: over.sub,
    email: over.email,
    roles: over.roles ?? [],
    send: (event: string, data: unknown) => received.push({ event, data }),
  };
  return { client, received };
}

// ── clientMatches (targeting) ─────────────────────────────────────────────────

test("clientMatches treats an empty/absent target as a broadcast", () => {
  const c = { sub: "u1", roles: ["admin"] };
  assert.equal(clientMatches(c), true);
  assert.equal(clientMatches(c, {}), true);
  assert.equal(clientMatches(c, { sub: undefined, email: undefined, role: undefined }), true);
});

test("clientMatches addresses by sub, email, or role", () => {
  const c = { sub: "u1", email: "u@test", roles: ["admin", "manager"] };
  assert.equal(clientMatches(c, { sub: "u1" }), true);
  assert.equal(clientMatches(c, { sub: "other" }), false);
  assert.equal(clientMatches(c, { email: "u@test" }), true);
  assert.equal(clientMatches(c, { email: "x@test" }), false);
  assert.equal(clientMatches(c, { role: "manager" }), true);
  assert.equal(clientMatches(c, { role: "viewer" }), false);
});

// ── addClient / clientCount / deliverLocal ────────────────────────────────────

test("addClient registers a client and returns a remover", () => {
  const before = clientCount();
  const { client } = fakeClient({ sub: "u1" });
  const remove = addClient(client);
  assert.equal(clientCount(), before + 1);
  remove();
  assert.equal(clientCount(), before);
  // Remover is idempotent (Set.delete is safe to repeat).
  remove();
  assert.equal(clientCount(), before);
});

test("deliverLocal fans a broadcast out to all connected clients", () => {
  const a = fakeClient({ sub: "a" });
  const b = fakeClient({ sub: "b" });
  const removeA = addClient(a.client);
  const removeB = addClient(b.client);
  try {
    const delivered = deliverLocal({ title: "hi" });
    assert.ok(delivered >= 2);
    assert.equal(a.received.at(-1)?.event, "notification");
    assert.deepEqual(a.received.at(-1)?.data, { title: "hi" });
    assert.deepEqual(b.received.at(-1)?.data, { title: "hi" });
  } finally {
    removeA();
    removeB();
  }
});

test("deliverLocal only reaches clients matching a targeted notification", () => {
  const a = fakeClient({ sub: "alice" });
  const b = fakeClient({ sub: "bob" });
  const removeA = addClient(a.client);
  const removeB = addClient(b.client);
  try {
    const delivered = deliverLocal({ title: "for alice" }, { sub: "alice" });
    assert.equal(delivered, 1);
    assert.equal(a.received.length, 1);
    assert.equal(b.received.length, 0);
  } finally {
    removeA();
    removeB();
  }
});

// ── notify-bus (in-process mode) ──────────────────────────────────────────────

test("busMode is in-process without REDIS_URL", () => {
  assert.equal(busMode(), "in-process");
});

test("getNotifyBus().publish delivers locally and returns the count", async () => {
  const { client, received } = fakeClient({ roles: ["admin"] });
  const remove = addClient(client);
  try {
    const bus = getNotifyBus();
    const count = await bus.publish({ notification: { title: "ping" }, target: { role: "admin" } });
    assert.equal(count, 1);
    assert.equal(received.at(-1)?.event, "notification");
    assert.deepEqual(received.at(-1)?.data, { title: "ping" });
  } finally {
    remove();
  }
});

test("getNotifyBus returns the same singleton instance", () => {
  assert.equal(getNotifyBus(), getNotifyBus());
});
