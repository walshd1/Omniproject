import { test, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * routes/api-spec.ts — the public, broker-agnostic consumer spec + discovery doc.
 * `PUBLIC_URL` is set before boot so baseUrl() resolves (rather than throwing the
 * host-header-injection guard), exercising the discovery document's ABSOLUTE-URL
 * branch (the relative-fallback branch is covered by the default harness where no
 * PUBLIC_URL is set).
 */
process.env["PUBLIC_URL"] = "https://omni.example.com";
let h: { close: () => void; req: (p: string) => Promise<Response> };

before(async () => {
  const { startHarness, adminCookie } = await import("./_harness");
  const base = await startHarness();
  const ADMIN = adminCookie();
  h = { close: base.close, req: (p: string) => base.req(p, { cookie: ADMIN }) };
});
after(() => h?.close());

test("GET /openapi.yaml serves the OpenAPI document as YAML", async () => {
  const r = await h.req("/openapi.yaml");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /yaml/);
  const text = await r.text();
  assert.match(text, /openapi:/);
});

test("GET /discovery returns absolute self-URLs built from PUBLIC_URL", async () => {
  const r = await h.req("/discovery");
  assert.equal(r.status, 200);
  const body = (await r.json()) as {
    brokerAgnostic: boolean;
    openapi: { url: string };
    brokerContract: string;
    outputs: { odata: string; metrics: string; mcp: string };
  };
  assert.equal(body.brokerAgnostic, true);
  assert.equal(body.openapi.url, "https://omni.example.com/api/openapi.yaml");
  assert.equal(body.brokerContract, "https://omni.example.com/api/contract");
  assert.equal(body.outputs.metrics, "https://omni.example.com/api/metrics");
});

test("GET /discovery degrades to RELATIVE paths when PUBLIC_URL is unset (baseUrl guard)", async () => {
  const saved = process.env["PUBLIC_URL"];
  delete process.env["PUBLIC_URL"]; // production-like + no PUBLIC_URL → baseUrl throws → relative fallback
  try {
    const r = await h.req("/discovery");
    assert.equal(r.status, 200);
    const body = (await r.json()) as { openapi: { url: string }; brokerContract: string };
    assert.equal(body.openapi.url, "/api/openapi.yaml");
    assert.equal(body.brokerContract, "/api/contract");
  } finally {
    process.env["PUBLIC_URL"] = saved;
  }
});
