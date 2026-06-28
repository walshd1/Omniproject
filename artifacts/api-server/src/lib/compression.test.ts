import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { compression, negotiateEncoding, isCompressible } from "./compression";

/**
 * Response compression: negotiate gzip/brotli, compress large text responses, and
 * leave small, ranged, already-encoded and Server-Sent-Event responses untouched.
 */

test("negotiateEncoding prefers brotli, then gzip, else null", () => {
  assert.equal(negotiateEncoding("br, gzip, deflate"), "br");
  assert.equal(negotiateEncoding("gzip, deflate"), "gzip");
  assert.equal(negotiateEncoding("deflate"), null);
  assert.equal(negotiateEncoding(undefined), null);
});

test("isCompressible gates on type, no-transform and prior encoding", () => {
  assert.equal(isCompressible("application/json", "private, no-cache", undefined), true);
  assert.equal(isCompressible("text/html", undefined, undefined), true);
  assert.equal(isCompressible("image/png", undefined, undefined), false);
  assert.equal(isCompressible("application/json", "no-transform", undefined), false); // SSE / opt-out
  assert.equal(isCompressible("text/event-stream", undefined, undefined), false);
  assert.equal(isCompressible("application/json", undefined, "gzip"), false); // already encoded
});

let server: Server;

before(async () => {
  const app = express();
  app.use(compression());
  app.get("/big", (_req, res) => res.json({ data: "x".repeat(5000) }));
  app.get("/small", (_req, res) => res.json({ ok: true }));
  app.get("/sse", (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" });
    res.write("event: ping\ndata: 1\n\n");
    res.end();
  });
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
});

after(() => server?.close());

interface Res { status: number; headers: http.IncomingHttpHeaders; body: Buffer }
function get(path: string, headers: Record<string, string> = {}): Promise<Res> {
  const { port } = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    http
      .get({ port, path, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      })
      .on("error", reject);
  });
}

test("compresses a large JSON body with gzip and it round-trips", async () => {
  const res = await get("/big", { "accept-encoding": "gzip" });
  assert.equal(res.headers["content-encoding"], "gzip");
  assert.equal(res.headers["vary"], "Accept-Encoding");
  const json = JSON.parse(zlib.gunzipSync(res.body).toString());
  assert.equal(json.data.length, 5000);
});

test("uses brotli when offered", async () => {
  const res = await get("/big", { "accept-encoding": "br" });
  assert.equal(res.headers["content-encoding"], "br");
  const json = JSON.parse(zlib.brotliDecompressSync(res.body).toString());
  assert.equal(json.data.length, 5000);
});

test("does not compress when the client accepts no encoding we speak", async () => {
  const res = await get("/big", { "accept-encoding": "identity" });
  assert.equal(res.headers["content-encoding"], undefined);
  assert.equal(JSON.parse(res.body.toString()).data.length, 5000);
});

test("leaves small responses uncompressed (below the threshold)", async () => {
  const res = await get("/small", { "accept-encoding": "gzip" });
  assert.equal(res.headers["content-encoding"], undefined);
  assert.deepEqual(JSON.parse(res.body.toString()), { ok: true });
});

test("never buffers Server-Sent Events — they stream straight through", async () => {
  const res = await get("/sse", { "accept-encoding": "gzip" });
  assert.equal(res.headers["content-encoding"], undefined);
  assert.match(res.body.toString(), /event: ping/);
});
