import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsStore } from "./store.mjs";
import { createHandler } from "./server.mjs";
import { signTicket } from "./ticket.mjs";

const TOKEN = "server-plane-token";
const SECRET = "ticket-secret";

/** Boot the handler on an ephemeral port, run fn(ctx), then tear down. */
async function withServer(fn, over = {}) {
  const dir = await mkdtemp(join(tmpdir(), "attach-srv-"));
  const store = createFsStore(dir);
  const handler = createHandler({ store, token: TOKEN, ticketSecret: SECRET, allowedOrigin: "*", ...over });
  const server = createServer((req, res) => void handler(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const bearer = { authorization: `Bearer ${TOKEN}` };
  const putTicket = (key) => signTicket({ op: "put", key, exp: Date.now() + 60_000 }, SECRET);
  const getTicket = (key, name) => signTicket({ op: "get", key, exp: Date.now() + 60_000, ...(name ? { name } : {}) }, SECRET);
  try {
    await fn({ base, bearer, putTicket, getTicket });
  } finally {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
}

test("GET /healthz is open", async () => {
  await withServer(async ({ base }) => {
    const r = await fetch(`${base}/healthz`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  });
});

test("portal: PUT with a valid ticket stores bytes; GET with a valid ticket returns them", async () => {
  await withServer(async ({ base, putTicket, getTicket }) => {
    const bytes = new Uint8Array([1, 2, 3, 250, 255]);
    const put = await fetch(`${base}/portal/k1?ticket=${putTicket("k1")}`, { method: "PUT", body: bytes });
    assert.equal(put.status, 200);
    const meta = await put.json();
    assert.equal(meta.size, bytes.length);
    assert.match(meta.sha256, /^[0-9a-f]{64}$/);
    assert.equal(put.headers.get("access-control-allow-origin"), "*"); // CORS present

    const get = await fetch(`${base}/portal/k1?ticket=${getTicket("k1", "report.bin")}`);
    assert.equal(get.status, 200);
    assert.match(get.headers.get("content-disposition") ?? "", /report\.bin/);
    assert.deepEqual([...new Uint8Array(await get.arrayBuffer())], [...bytes]);
  });
});

test("portal: an upload that fails the malware scan is 422 and is NOT stored", async () => {
  await withServer(async ({ base, putTicket, getTicket }) => {
    // The EICAR test signature (assembled from fragments) must be rejected by the always-on heuristic scan.
    const eicar = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}", "$EICAR-STANDARD-", "ANTIVIRUS-TEST-FILE!", "$H+H*"].join("");
    const put = await fetch(`${base}/portal/mal?ticket=${putTicket("mal")}`, { method: "PUT", body: eicar });
    assert.equal(put.status, 422);
    assert.equal((await put.json()).reason, "eicar-test-signature");
    // Nothing was written, so a later fetch with a valid ticket 404s.
    assert.equal((await fetch(`${base}/portal/mal?ticket=${getTicket("mal")}`)).status, 404);

    // A raw executable (PE "MZ" magic) is refused by content, regardless of name.
    const exe = await fetch(`${base}/portal/exe?ticket=${putTicket("exe")}`, { method: "PUT", body: new Uint8Array([0x4d, 0x5a, 0x90, 0x0]) });
    assert.equal(exe.status, 422);
    assert.match((await exe.json()).reason, /executable/);
  });
});

test("portal: a missing/invalid/expired/wrong-op ticket is 401", async () => {
  await withServer(async ({ base, putTicket, getTicket }) => {
    assert.equal((await fetch(`${base}/portal/k1`, { method: "PUT", body: "x" })).status, 401); // no ticket
    assert.equal((await fetch(`${base}/portal/k1?ticket=garbage`, { method: "PUT", body: "x" })).status, 401);
    // a get-ticket can't be used for a PUT (op mismatch)
    assert.equal((await fetch(`${base}/portal/k1?ticket=${getTicket("k1")}`, { method: "PUT", body: "x" })).status, 401);
    const expired = signTicket({ op: "get", key: "k1", exp: Date.now() - 1 }, SECRET);
    assert.equal((await fetch(`${base}/portal/k1?ticket=${expired}`)).status, 401);
    // fetching an unwritten key with a valid ticket is 404
    assert.equal((await fetch(`${base}/portal/ghost?ticket=${getTicket("ghost")}`)).status, 404);
  });
});

test("portal: OPTIONS preflight returns 204 with CORS", async () => {
  await withServer(async ({ base }) => {
    const r = await fetch(`${base}/portal/k1`, { method: "OPTIONS" });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get("access-control-allow-methods"), "PUT, GET, OPTIONS");
  });
});

test("portal is disabled (503) when no ticket secret is configured", async () => {
  await withServer(async ({ base, putTicket }) => {
    assert.equal((await fetch(`${base}/portal/k1?ticket=${putTicket("k1")}`, { method: "PUT", body: "x" })).status, 503);
  }, { ticketSecret: undefined });
});

test("server plane: HEAD returns size + DELETE removes, both bearer-gated", async () => {
  await withServer(async ({ base, bearer, putTicket }) => {
    await fetch(`${base}/portal/d1?ticket=${putTicket("d1")}`, { method: "PUT", body: new Uint8Array(7) });
    assert.equal((await fetch(`${base}/blob/d1`, { method: "HEAD" })).status, 401); // no bearer
    const head = await fetch(`${base}/blob/d1`, { method: "HEAD", headers: bearer });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("x-attachment-size"), "7");
    assert.equal((await fetch(`${base}/blob/d1`, { method: "DELETE", headers: bearer })).status, 200);
    assert.equal((await fetch(`${base}/blob/d1`, { method: "HEAD", headers: bearer })).status, 404);
  });
});
