import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createHandler } from "./server";
import type { RetentionSource } from "./contract";

function stubSource(): RetentionSource {
  return {
    readSnapshots: async () => [{ entity: "issue", id: "1", asOf: "2026-01-10T00:00:00Z", values: { percentWorkComplete: 42 }, provenance: "replayed" }],
    readJournal: async () => [],
    appendJournal: async () => {},
    writeSnapshot: async () => {},
    lastSnapshotAt: async () => "2026-01-10T00:00:00Z",
  };
}

async function withServer(token: string | undefined, fn: (base: string) => Promise<void>): Promise<void> {
  const handler = createHandler(stubSource(), token);
  const server: Server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test("GET /healthz is 200", async () => {
  await withServer(undefined, async (base) => {
    const r = await fetch(`${base}/healthz`);
    assert.equal(r.status, 200);
  });
});

test("POST /retention/read-snapshots dispatches and returns rows", async () => {
  await withServer(undefined, async (base) => {
    const r = await fetch(`${base}/retention/read-snapshots`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity: "issue", ids: ["1"], window: { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" } }),
    });
    assert.equal(r.status, 200);
    const rows = (await r.json()) as { values: { percentWorkComplete: number } }[];
    assert.equal(rows[0]!.values.percentWorkComplete, 42);
  });
});

test("an unknown op is 404", async () => {
  await withServer(undefined, async (base) => {
    const r = await fetch(`${base}/retention/nuke`, { method: "POST", body: "{}" });
    assert.equal(r.status, 404);
  });
});

test("a bearer token gates the retention ops", async () => {
  await withServer("s3cr3t", async (base) => {
    const noauth = await fetch(`${base}/retention/last-snapshot-at`, { method: "POST", body: JSON.stringify({ entity: "issue", id: "1" }) });
    assert.equal(noauth.status, 401);
    const ok = await fetch(`${base}/retention/last-snapshot-at`, {
      method: "POST", headers: { authorization: "Bearer s3cr3t" }, body: JSON.stringify({ entity: "issue", id: "1" }),
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { asOf: "2026-01-10T00:00:00Z" });
  });
});

test("a wrong bearer token is rejected", async () => {
  await withServer("s3cr3t", async (base) => {
    const r = await fetch(`${base}/retention/last-snapshot-at`, {
      method: "POST", headers: { authorization: "Bearer wrong" }, body: JSON.stringify({ entity: "issue", id: "1" }),
    });
    assert.equal(r.status, 401);
  });
});

test("a malformed body is 400 with a validation message, not 500", async () => {
  await withServer(undefined, async (base) => {
    // ids must be an array of strings; a number is a shape violation.
    const r = await fetch(`${base}/retention/read-snapshots`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity: "issue", ids: 5, window: { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" } }),
    });
    assert.equal(r.status, 400);
    const body = (await r.json()) as { error: string };
    assert.match(body.error, /ids must be an array/);
  });
});

test("a non-ISO timestamp is rejected (key-injection guard)", async () => {
  await withServer(undefined, async (base) => {
    const r = await fetch(`${base}/retention/write-snapshot`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshot: { entity: "issue", id: "1", asOf: "2026/01/10#evil", values: {}, provenance: "replayed" } }),
    });
    assert.equal(r.status, 400);
    const body = (await r.json()) as { error: string };
    assert.match(body.error, /asOf must be an ISO-8601 timestamp/);
  });
});

test("POST /retention/dispose-older-than dispatches to the source", async () => {
  const src: RetentionSource = { ...stubSource(), disposeOlderThan: async () => ({ snapshots: 2, journal: 5 }) };
  const handler = createHandler(src, undefined);
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/retention/dispose-older-than`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ cutoff: "2026-01-01T00:00:00Z", heldKeys: ["issue#2"] }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { snapshots: 2, journal: 5 });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("a disposal op on a source that can't delete is 501, not 500", async () => {
  // stubSource has no disposeOlderThan → UnsupportedOpError → 501.
  await withServer(undefined, async (base) => {
    const r = await fetch(`${base}/retention/erase-entity`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ entity: "issue", id: "1" }),
    });
    assert.equal(r.status, 501);
    const body = (await r.json()) as { error: string };
    assert.match(body.error, /does not support/);
  });
});

test("a backend failure is a generic 500, not a leaked message", async () => {
  const boom: RetentionSource = { ...stubSource(), lastSnapshotAt: async () => { throw new Error("s3 bucket acme-secrets denied req-abc123"); } };
  const handler = createHandler(boom, undefined);
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/retention/last-snapshot-at`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entity: "issue", id: "1" }),
    });
    assert.equal(r.status, 500);
    const body = (await r.json()) as { error: string };
    assert.equal(body.error, "internal error");
    assert.doesNotMatch(body.error, /acme-secrets/);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
