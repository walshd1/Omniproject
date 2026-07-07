import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fetchPeerSummary } from "./federation";
import type { PeerInstance } from "./settings";

/** Spin up a tiny HTTP server standing in for a peer's `GET /api/portfolio/summary`, so the fan-out
 *  is tested against real network behaviour (not a stubbed fetch) — same style as the reference
 *  broker/webhook tests in this codebase. Caller closes it. */
function startPeer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ server: http.Server; base: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function peer(overrides: Partial<PeerInstance>): PeerInstance {
  return { id: "eu", label: "EU", baseUrl: "http://127.0.0.1:1", token: "tok", region: "eu", active: true, ...overrides };
}

test("fetchPeerSummary: a healthy peer returns status ok with its summary, over the presented bearer token", async () => {
  let seenAuth: string | null = null;
  const { server, base } = await startPeer((req, res) => {
    seenAuth = req.headers["authorization"] ?? null;
    assert.equal(req.url, "/api/portfolio/summary");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ projects: 3, health: null, finance: null, capacity: null }));
  });
  try {
    const result = await fetchPeerSummary(peer({ baseUrl: base, token: "secret-tok" }));
    assert.equal(result.status, "ok");
    assert.equal(result.summary?.projects, 3);
    assert.equal(seenAuth, "Bearer secret-tok");
  } finally {
    server.close();
  }
});

test("fetchPeerSummary: a 401/403 from the peer degrades to status unauthorized, not a throw", async () => {
  const { server, base } = await startPeer((_req, res) => { res.writeHead(401); res.end("{}"); });
  try {
    const result = await fetchPeerSummary(peer({ baseUrl: base }));
    assert.equal(result.status, "unauthorized");
    assert.equal(result.summary, null);
  } finally {
    server.close();
  }
});

test("fetchPeerSummary: a non-2xx (not auth-related) degrades to status error", async () => {
  const { server, base } = await startPeer((_req, res) => { res.writeHead(500); res.end("boom"); });
  try {
    const result = await fetchPeerSummary(peer({ baseUrl: base }));
    assert.equal(result.status, "error");
    assert.equal(result.summary, null);
  } finally {
    server.close();
  }
});

test("fetchPeerSummary: an unreachable peer degrades to status unreachable — never throws", async () => {
  // Port 1 is a privileged/closed port on loopback — nothing is listening, so the connection is refused.
  const result = await fetchPeerSummary(peer({ baseUrl: "http://127.0.0.1:1" }));
  assert.equal(result.status, "unreachable");
  assert.equal(result.summary, null);
});

test("fetchPeerSummary: trims a trailing slash on baseUrl before appending the summary path", async () => {
  const { server, base } = await startPeer((req, res) => {
    assert.equal(req.url, "/api/portfolio/summary");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ projects: 0, health: null, finance: null, capacity: null }));
  });
  try {
    const result = await fetchPeerSummary(peer({ baseUrl: `${base}/` }));
    assert.equal(result.status, "ok");
  } finally {
    server.close();
  }
});

test("fetchPeerSummary: a peer with no region reports region null", async () => {
  const { server, base } = await startPeer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ projects: 1, health: null, finance: null, capacity: null }));
  });
  try {
    const result = await fetchPeerSummary(peer({ baseUrl: base, region: undefined }));
    assert.equal(result.region, null);
    assert.equal(result.status, "ok");
  } finally {
    server.close();
  }
});

test("fetchPeerSummary: a timeout is labeled 'timed out' (not a plain 'unreachable')", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    throw err;
  }) as typeof fetch;
  try {
    const result = await fetchPeerSummary(peer({ baseUrl: "http://127.0.0.1:1" }));
    assert.equal(result.status, "unreachable");
    assert.equal(result.error, "timed out");
  } finally {
    globalThis.fetch = realFetch;
  }
});
