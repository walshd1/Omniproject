import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { heuristicScan, clamdScan, scanBlob } from "./scan.mjs";

// The EICAR test signature, assembled from fragments (so this test file doesn't contain it contiguously).
const EICAR = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}", "$EICAR-STANDARD-", "ANTIVIRUS-TEST-FILE!", "$H+H*"].join("");

/** A fake clamd that speaks just enough INSTREAM to reply with a canned verdict once the client finishes. */
function fakeClamd(reply) {
  const server = net.createServer((sock) => {
    let timer;
    const flush = () => { sock.write(reply); sock.end(); };
    sock.on("data", () => { clearTimeout(timer); timer = setTimeout(flush, 20); }); // reply after the writes settle
    sock.on("error", () => {});
  });
  return server;
}
async function withClamd(reply, fn) {
  const server = fakeClamd(reply);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const address = `127.0.0.1:${server.address().port}`;
  try { await fn(address); } finally { await new Promise((r) => server.close(r)); }
}

test("heuristicScan flags the EICAR test signature", () => {
  assert.deepEqual(heuristicScan(Buffer.from(EICAR)), { ok: false, reason: "eicar-test-signature" });
});

test("heuristicScan refuses raw executables by magic bytes (rename can't hide them)", () => {
  assert.match(heuristicScan(Buffer.from([0x4d, 0x5a, 0x90, 0x00])).reason, /executable:dos-pe/); // MZ
  assert.match(heuristicScan(Buffer.from([0x7f, 0x45, 0x4c, 0x46])).reason, /executable:elf/);     // ELF
  assert.match(heuristicScan(Buffer.from("#!/bin/sh\nrm -rf /")).reason, /executable:script-shebang/);
});

test("heuristicScan passes an ordinary document and honours allowExecutables", () => {
  assert.deepEqual(heuristicScan(Buffer.from("%PDF-1.7\n... a normal doc ...")), { ok: true });
  assert.equal(heuristicScan(Buffer.from([0x4d, 0x5a, 0x00]), { allowExecutables: true }).ok, true);
  assert.deepEqual(heuristicScan(Buffer.alloc(0)), { ok: false, reason: "empty" });
});

test("clamdScan returns ok on a clean stream verdict", async () => {
  await withClamd("stream: OK\0", async (address) => {
    assert.deepEqual(await clamdScan(Buffer.from("hello"), address), { ok: true });
  });
});

test("clamdScan returns the signature name on a FOUND verdict", async () => {
  await withClamd("stream: Win.Test.EICAR_HDB-1 FOUND\0", async (address) => {
    assert.deepEqual(await clamdScan(Buffer.from("x"), address), { ok: false, reason: "clamav:Win.Test.EICAR_HDB-1" });
  });
});

test("clamdScan resolves an error verdict (never throws) when clamd is unreachable", async () => {
  const v = await clamdScan(Buffer.from("x"), "127.0.0.1:1", 500); // nothing listening on port 1
  assert.equal(v.ok, false);
  assert.equal(v.error, true);
  assert.match(v.reason, /unreachable|timeout/);
});

test("scanBlob short-circuits on a heuristic hit (never reaches clamd)", async () => {
  const v = await scanBlob(Buffer.from(EICAR), { clamavAddress: "127.0.0.1:1" });
  assert.deepEqual(v, { ok: false, reason: "eicar-test-signature" });
});

test("scanBlob fails CLOSED when clamd errors, and fails OPEN (degraded) only when opted in", async () => {
  const clean = Buffer.from("%PDF-1.7 doc");
  const closed = await scanBlob(clean, { clamavAddress: "127.0.0.1:1", clamavTimeoutMs: 500 });
  assert.equal(closed.ok, false); // scanner down ⇒ rejected by default
  const open = await scanBlob(clean, { clamavAddress: "127.0.0.1:1", clamavTimeoutMs: 500, failOpen: true });
  assert.equal(open.ok, true);
  assert.match(open.degraded, /unreachable|timeout/);
});

test("scanBlob passes a clean file that clamd also clears", async () => {
  await withClamd("stream: OK\0", async (address) => {
    assert.deepEqual(await scanBlob(Buffer.from("%PDF-1.7 doc"), { clamavAddress: address }), { ok: true });
  });
});
