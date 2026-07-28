import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsStore, isValidKey, sha256Hex } from "./store.mjs";

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), "attach-store-"));
  try {
    await fn(createFsStore(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("isValidKey accepts flat tokens and rejects traversal", () => {
  assert.equal(isValidKey("a1b2-c3.d_4"), true);
  assert.equal(isValidKey("x".repeat(200)), true);
  assert.equal(isValidKey(""), false);
  assert.equal(isValidKey("x".repeat(201)), false);
  assert.equal(isValidKey("a/b"), false);
  assert.equal(isValidKey("../secret"), false);
  assert.equal(isValidKey(".."), false);
  assert.equal(isValidKey("."), false);
  assert.equal(isValidKey("a b"), false);
  assert.equal(isValidKey(42), false);
});

test("put → get round-trips the exact bytes and reports size + sha256", async () => {
  await withStore(async (store) => {
    const buf = Buffer.from("hello attachment \u{1F4CE}", "utf8");
    const meta = await store.put("k1", buf);
    assert.equal(meta.key, "k1");
    assert.equal(meta.size, buf.length);
    assert.equal(meta.sha256, sha256Hex(buf));
    const got = await store.get("k1");
    assert.ok(got.equals(buf));
  });
});

test("get/has return null/false for a missing blob", async () => {
  await withStore(async (store) => {
    assert.equal(await store.get("nope"), null);
    assert.equal(await store.has("nope"), false);
  });
});

test("has is true after put, del removes and reports it", async () => {
  await withStore(async (store) => {
    await store.put("k2", Buffer.from("x"));
    assert.equal(await store.has("k2"), true);
    assert.equal(await store.del("k2"), true);
    assert.equal(await store.has("k2"), false);
    assert.equal(await store.del("k2"), false); // already gone
  });
});

test("an invalid key throws rather than escaping the root", async () => {
  await withStore(async (store) => {
    await assert.rejects(() => store.put("../escape", Buffer.from("x")), /invalid key/);
    await assert.rejects(() => store.get("a/b"), /invalid key/);
  });
});
