import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { OmniStore } from "./omnistore";
import { MemoryStore } from "./store";
import { BuiltinBroker } from "./builtin-broker";
import type { ActorContext, WhiteboardWrite } from "../types";

/**
 * Whiteboards on the built-in (sidecar) system-of-record: the OmniStore persists scenes in its encrypted,
 * hash-chained event log (durable across a restart), and the broker enforces org-wide vs personal ownership.
 */
const root = () => crypto.createHash("sha256").update("wb-test-root").digest();
const alice: ActorContext = { sub: "alice", email: "alice@x.test", role: "manager" };
const bob: ActorContext = { sub: "bob", email: "bob@x.test", role: "manager" };
const scene = () => ({ elements: [{ id: "s1", type: "sticky" as const, x: 0, y: 0, text: "hi", color: "yellow" as const }] });
const write = (name: string, visibility?: "org" | "user"): WhiteboardWrite => ({ name, scene: scene(), ...(visibility ? { visibility } : {}) });

test("a store without whiteboard support leaves the broker methods undefined (routes then 501)", () => {
  // The SidecarStore analogue: a store missing saveWhiteboard ⇒ no capability exposed.
  const bare = { name: "bare" } as unknown as ConstructorParameters<typeof BuiltinBroker>[0];
  const b = new BuiltinBroker(bare);
  assert.equal(b.getWhiteboard, undefined);
  assert.equal(b.writeWhiteboard, undefined);
});

test("memory + omnistore expose whiteboards; create stamps owner from the caller", async () => {
  for (const store of [new MemoryStore(), new OmniStore(root())]) {
    const b = new BuiltinBroker(store);
    assert.ok(b.writeWhiteboard, `${store.name} exposes writeWhiteboard`);
    const created = (await b.writeWhiteboard!(alice, "create", write("Board")))!;
    assert.equal(created.ownerSub, "alice", "owner stamped from ctx.sub, not the client");
    assert.equal(created.visibility, "org", "defaults to org-wide");
    assert.ok(created.id.startsWith("wb-"));
  }
});

test("org-wide vs personal: a personal board is invisible to non-owners; org boards are shared", async () => {
  const b = new BuiltinBroker(new OmniStore(root()));
  const org = (await b.writeWhiteboard!(alice, "create", write("Shared", "org")))!;
  const personal = (await b.writeWhiteboard!(alice, "create", write("My private", "user")))!;

  // Alice sees both; Bob sees only the org board.
  const aliceList = await b.listWhiteboards!(alice);
  const bobList = await b.listWhiteboards!(bob);
  assert.deepEqual(aliceList.map((w) => w.id).sort(), [org.id, personal.id].sort());
  assert.deepEqual(bobList.map((w) => w.id), [org.id]);

  // Bob can't read Alice's personal board...
  assert.equal(await b.getWhiteboard!(bob, personal.id), null);
  assert.ok(await b.getWhiteboard!(alice, personal.id), "owner can read it");
  // ...nor update or delete it (not_found, fail-closed — no info leak).
  await assert.rejects(() => b.writeWhiteboard!(bob, "delete", { ...write("x"), id: personal.id }));
  await assert.rejects(() => b.writeWhiteboard!(bob, "update", { ...write("hijack"), id: personal.id }));
});

test("an update preserves the owner and cannot transfer ownership via the client", async () => {
  const b = new BuiltinBroker(new OmniStore(root()));
  const board = (await b.writeWhiteboard!(alice, "create", write("Board")))!;
  const updated = (await b.writeWhiteboard!(alice, "update", { ...write("Renamed"), id: board.id }))!;
  assert.equal(updated.name, "Renamed");
  assert.equal(updated.ownerSub, "alice", "owner unchanged by an update");
});

test("scenes survive a restart: seal → openSealed rebuilds the boards (durable at rest)", async () => {
  const s = new OmniStore(root());
  const b = new BuiltinBroker(s);
  const board = (await b.writeWhiteboard!(alice, "create", write("Persisted", "org")))!;
  const token = s.sealed();

  const reopened = new BuiltinBroker(OmniStore.openSealed(token, root()));
  const back = await reopened.getWhiteboard!(alice, board.id);
  assert.ok(back, "board survived the restart");
  assert.equal(back!.name, "Persisted");
  assert.equal((back!.scene.elements[0] as { text: string }).text, "hi", "scene body persisted");
});
