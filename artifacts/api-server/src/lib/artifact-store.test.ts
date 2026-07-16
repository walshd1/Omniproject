import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod"; // lets sealConfig derive a key

let dir: string;
let store: typeof import("./artifact-store");

interface Board { id: string; name: string }

before(async () => { store = await import("./artifact-store"); });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-store-"));
  process.env["OMNI_CONFIG_DIR"] = dir;
});
after(() => { delete process.env["OMNI_CONFIG_DIR"]; });

test("put → get → list → delete round-trips within a scope", () => {
  const scope = { kind: "org" as const };
  store.putArtifact<Board>("whiteboard", scope, { id: "a", name: "Alpha" });
  store.putArtifact<Board>("whiteboard", scope, { id: "b", name: "Beta" });
  assert.equal(store.getArtifact<Board>("whiteboard", scope, "a")?.name, "Alpha");
  assert.deepEqual(store.listArtifacts<Board>("whiteboard", scope).map((x) => x.id).sort(), ["a", "b"]);
  // Upsert replaces in place.
  store.putArtifact<Board>("whiteboard", scope, { id: "a", name: "Alpha2" });
  assert.equal(store.getArtifact<Board>("whiteboard", scope, "a")?.name, "Alpha2");
  assert.equal(store.deleteArtifact("whiteboard", scope, "a"), true);
  assert.equal(store.getArtifact<Board>("whiteboard", scope, "a"), null);
  assert.equal(store.deleteArtifact("whiteboard", scope, "a"), false); // already gone
});

test("scopes are isolated: two users never see each other's area", () => {
  store.putArtifact<Board>("whiteboard", { kind: "user", sub: "alice" }, { id: "x", name: "Alice private" });
  store.putArtifact<Board>("whiteboard", { kind: "user", sub: "bob" }, { id: "y", name: "Bob private" });
  assert.deepEqual(store.listArtifacts<Board>("whiteboard", { kind: "user", sub: "alice" }).map((b) => b.id), ["x"]);
  assert.deepEqual(store.listArtifacts<Board>("whiteboard", { kind: "user", sub: "bob" }).map((b) => b.id), ["y"]);
  // project scope is separate again
  store.putArtifact<Board>("whiteboard", { kind: "project", projectId: "proj-001" }, { id: "p", name: "Proj" });
  assert.deepEqual(store.listArtifacts<Board>("whiteboard", { kind: "project", projectId: "proj-001" }).map((b) => b.id), ["p"]);
  assert.deepEqual(store.listArtifacts<Board>("whiteboard", { kind: "org" }), []);
});

test("collections are SEALED at rest (not plaintext on disk)", () => {
  store.putArtifact<Board>("whiteboard", { kind: "org" }, { id: "s", name: "Secret name" });
  const file = path.join(dir, "artifacts", "whiteboard", "org.json");
  const onDisk = fs.readFileSync(file, "utf8");
  assert.ok(!onDisk.includes("Secret name"), "the plaintext name must not appear on disk");
  assert.match(onDisk, /^c[12]\./, "the file is an AES-256-GCM sealed config token");
});

test("the store is disabled (empty, no throw) when no OMNI_CONFIG_DIR is set", () => {
  delete process.env["OMNI_CONFIG_DIR"];
  assert.equal(store.artifactStoreEnabled(), false);
  assert.deepEqual(store.listArtifacts<Board>("whiteboard", { kind: "org" }), []);
  store.putArtifact<Board>("whiteboard", { kind: "org" }, { id: "z", name: "N" }); // no-op, no throw
  assert.equal(store.getArtifact<Board>("whiteboard", { kind: "org" }, "z"), null);
});
