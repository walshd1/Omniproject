import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsStore } from "./store.mjs";
import { createHandler } from "./server.mjs";

const TOKEN = "test-token-abc";

/** Boot the handler on an ephemeral port, run `fn(baseUrl)`, then tear everything down. */
async function withServer(fn, { token = TOKEN, maxBytes } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "attach-srv-"));
  const store = createFsStore(dir);
  const handler = createHandler(store, token, maxBytes ? { maxBytes } : {});
  const server = createServer((req, res) => void handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const auth = token ? { authorization: `Bearer ${token}` } : {};
  try {
    await fn({ base, auth });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

test("GET /healthz is open (no auth) and reports ok", async () => {
  await withServer(async ({ base }) => {
    const r = await fetch(`${base}/healthz`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  });
});

test("/blob/* requires the bearer token", async () => {
  await withServer(async ({ base }) => {
    const r = await fetch(`${base}/blob/k1`, { method: "PUT", body: "x" });
    assert.equal(r.status, 401);
  });
});

test("PUT then GET round-trips the bytes with a content fingerprint", async () => {
  await withServer(async ({ base, auth }) => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 254, 255]);
    const put = await fetch(`${base}/blob/blob-1`, { method: "PUT", headers: auth, body: bytes });
    assert.equal(put.status, 200);
    const meta = await put.json();
    assert.equal(meta.ok, true);
    assert.equal(meta.size, bytes.length);
    assert.match(meta.sha256, /^[0-9a-f]{64}$/);

    const get = await fetch(`${base}/blob/blob-1`, { headers: auth });
    assert.equal(get.status, 200);
    assert.equal(get.headers.get("content-type"), "application/octet-stream");
    const back = new Uint8Array(await get.arrayBuffer());
    assert.deepEqual([...back], [...bytes]);
  });
});

test("GET a missing blob is 404; DELETE removes it", async () => {
  await withServer(async ({ base, auth }) => {
    assert.equal((await fetch(`${base}/blob/ghost`, { headers: auth })).status, 404);
    await fetch(`${base}/blob/d1`, { method: "PUT", headers: auth, body: "hi" });
    assert.equal((await fetch(`${base}/blob/d1`, { method: "DELETE", headers: auth })).status, 200);
    assert.equal((await fetch(`${base}/blob/d1`, { headers: auth })).status, 404);
  });
});

test("an over-limit upload is rejected 413", async () => {
  await withServer(async ({ base, auth }) => {
    const r = await fetch(`${base}/blob/big`, { method: "PUT", headers: auth, body: new Uint8Array(64) });
    assert.equal(r.status, 413);
  }, { maxBytes: 16 });
});

test("an invalid key is 400; an unknown path is 404", async () => {
  await withServer(async ({ base, auth }) => {
    assert.equal((await fetch(`${base}/blob/${encodeURIComponent("a/b")}`, { headers: auth })).status, 400);
    assert.equal((await fetch(`${base}/nope`, { headers: auth })).status, 404);
  });
});
