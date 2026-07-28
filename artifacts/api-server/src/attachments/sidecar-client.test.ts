import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAttachmentsClient, registerAttachmentsFromEnv, attachmentsSidecar } from "./sidecar-client";

/** A fake fetch that records calls and returns canned responses keyed by `METHOD path`. */
function fakeFetch(routes: Record<string, { status?: number; json?: unknown; bytes?: Uint8Array }>) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({
      url: String(url),
      method,
      headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {})),
      body: init?.body,
    });
    const r = routes[`${method} ${u.pathname}`] ?? { status: 200, json: {} };
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r.json ?? {},
      arrayBuffer: async () => (r.bytes ? r.bytes.buffer : new ArrayBuffer(0)),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const BASE = "http://attachments-broker:8091";

test("putBlob PUTs to /blob/<key> with the bearer token and returns the fingerprint", async () => {
  const { impl, calls } = fakeFetch({ "PUT /blob/k1": { json: { ok: true, size: 3, sha256: "abc" } } });
  const client = makeAttachmentsClient({ baseUrl: BASE, token: "t0k", fetchImpl: impl });
  const meta = await client.putBlob("k1", Buffer.from("hey"), "text/plain");
  assert.equal(meta.size, 3);
  assert.equal(meta.sha256, "abc");
  assert.equal(calls[0]!.method, "PUT");
  assert.match(calls[0]!.url, /\/blob\/k1$/);
  assert.equal(calls[0]!.headers["authorization"], "Bearer t0k");
  assert.equal(calls[0]!.headers["content-type"], "text/plain");
});

test("getBlob returns bytes, and null on 404", async () => {
  const bytes = new Uint8Array([9, 8, 7]);
  const { impl } = fakeFetch({ "GET /blob/hit": { bytes }, "GET /blob/miss": { status: 404 } });
  const client = makeAttachmentsClient({ baseUrl: BASE, fetchImpl: impl });
  const got = await client.getBlob("hit");
  assert.deepEqual(got ? [...got] : null, [9, 8, 7]);
  assert.equal(await client.getBlob("miss"), null);
});

test("delBlob tolerates a 404 (idempotent) and health maps ok", async () => {
  const { impl } = fakeFetch({ "DELETE /blob/gone": { status: 404 }, "GET /healthz": { status: 200 } });
  const client = makeAttachmentsClient({ baseUrl: BASE, fetchImpl: impl });
  await client.delBlob("gone"); // must not throw
  assert.equal(await client.health(), true);
});

test("registerAttachmentsFromEnv is off-by-default and gates the client", () => {
  assert.equal(registerAttachmentsFromEnv({} as NodeJS.ProcessEnv), false);
  assert.equal(attachmentsSidecar(), null);
  assert.equal(registerAttachmentsFromEnv({ ATTACHMENTS_SIDECAR_URL: BASE, ATTACHMENTS_SIDECAR_TOKEN: "t" } as unknown as NodeJS.ProcessEnv), true);
  assert.ok(attachmentsSidecar());
  // Unsetting clears it again.
  assert.equal(registerAttachmentsFromEnv({} as NodeJS.ProcessEnv), false);
  assert.equal(attachmentsSidecar(), null);
});
