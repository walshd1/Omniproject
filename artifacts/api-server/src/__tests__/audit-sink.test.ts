import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit tests for the audit subsystem (lib/audit): the pure level/decision logic
 * and the batched, best-effort external HTTP sink. The sink takes an injected
 * fetchImpl, so no real network is used — we drive success, batch-triggered
 * flush, and the failure/re-buffer path directly.
 */
const { auditLevel, shouldAudit, createHttpSink } = await import("../lib/audit");

function ev(over: Partial<{ category: "request" | "broker" | "auth" | "admin"; method: string; write: boolean }> = {}) {
  return { category: over.category ?? "request", method: over.method, write: over.write };
}

test("auditLevel defaults to 'writes' and honours off/all", () => {
  const saved = process.env["AUDIT_LEVEL"];
  try {
    delete process.env["AUDIT_LEVEL"];
    assert.equal(auditLevel(), "writes");
    process.env["AUDIT_LEVEL"] = "weird";
    assert.equal(auditLevel(), "writes");
    process.env["AUDIT_LEVEL"] = "off";
    assert.equal(auditLevel(), "off");
    process.env["AUDIT_LEVEL"] = "ALL";
    assert.equal(auditLevel(), "all");
  } finally {
    if (saved === undefined) delete process.env["AUDIT_LEVEL"];
    else process.env["AUDIT_LEVEL"] = saved;
  }
});

test("shouldAudit: 'off' records nothing, 'all' records everything", () => {
  assert.equal(shouldAudit("off", ev({ method: "POST", write: true })), false);
  assert.equal(shouldAudit("all", ev({ method: "GET" })), true);
});

test("shouldAudit 'writes' records auth/admin/writes but not plain reads", () => {
  assert.equal(shouldAudit("writes", ev({ category: "auth", method: "GET" })), true);
  assert.equal(shouldAudit("writes", ev({ category: "admin", method: "GET" })), true);
  assert.equal(shouldAudit("writes", ev({ write: true })), true);
  assert.equal(shouldAudit("writes", ev({ method: "DELETE" })), true);
  assert.equal(shouldAudit("writes", ev({ method: "patch" })), true); // case-insensitive
  assert.equal(shouldAudit("writes", ev({ category: "request", method: "GET" })), false);
});

test("createHttpSink flushes a batch as NDJSON with the bearer token", async () => {
  let captured: { url: string; headers: Headers; body: string } | null = null;
  const sink = createHttpSink({
    url: "https://sink.test/ingest",
    token: "sink-token",
    batch: 100,
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), headers: new Headers(init?.headers), body: String(init?.body) };
      return new Response("ok", { status: 200 });
    }) as typeof fetch,
  });

  sink.enqueue({ ts: "t1", category: "auth", action: "login" });
  sink.enqueue({ ts: "t2", category: "request", action: "read" });
  assert.equal(sink.size(), 2);

  const sent = await sink.flush();
  assert.equal(sent, 2);
  assert.equal(sink.size(), 0);
  assert.equal(captured!.url, "https://sink.test/ingest");
  assert.equal(captured!.headers.get("authorization"), "Bearer sink-token");
  assert.equal(captured!.headers.get("content-type"), "application/x-ndjson");
  // NDJSON: one JSON object per line.
  const lines = captured!.body.split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]!).action, "login"); // lines.length asserted === 2 above
});

test("createHttpSink auto-flushes when the batch threshold is reached", async () => {
  let calls = 0;
  const sink = createHttpSink({
    url: "https://sink.test/ingest",
    batch: 2,
    fetchImpl: (async () => {
      calls++;
      return new Response("", { status: 200 });
    }) as typeof fetch,
  });
  sink.enqueue({ ts: "1", category: "request", action: "a" });
  assert.equal(calls, 0);
  sink.enqueue({ ts: "2", category: "request", action: "b" }); // hits batch=2 → auto flush
  // The auto-flush is fire-and-forget; let the microtask settle.
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
});

test("createHttpSink flush of an empty buffer is a no-op", async () => {
  let calls = 0;
  const sink = createHttpSink({
    url: "https://sink.test/ingest",
    fetchImpl: (async () => {
      calls++;
      return new Response("", { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(await sink.flush(), 0);
  assert.equal(calls, 0);
});

test("createHttpSink re-buffers events when the sink responds non-ok", async () => {
  const sink = createHttpSink({
    url: "https://sink.test/ingest",
    batch: 100,
    fetchImpl: (async () => new Response("server error", { status: 500 })) as typeof fetch,
  });
  sink.enqueue({ ts: "1", category: "request", action: "a" });
  const sent = await sink.flush();
  assert.equal(sent, 0); // delivery failed
  assert.equal(sink.size(), 1); // event re-buffered, not lost
});

test("createHttpSink re-buffers events when fetch throws", async () => {
  const sink = createHttpSink({
    url: "https://sink.test/ingest",
    batch: 100,
    fetchImpl: (async () => {
      throw new Error("connection refused");
    }) as typeof fetch,
  });
  sink.enqueue({ ts: "1", category: "request", action: "a" });
  sink.enqueue({ ts: "2", category: "request", action: "b" });
  assert.equal(await sink.flush(), 0);
  assert.equal(sink.size(), 2);
});
