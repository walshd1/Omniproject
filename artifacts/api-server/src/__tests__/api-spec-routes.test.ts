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

test("GET /docs: the API portal is OFF by default → 404", async () => {
  delete process.env["API_PORTAL_ENABLED"];
  const r = await h.req("/docs");
  assert.equal(r.status, 404);
});

test("GET /docs: with API_PORTAL_ENABLED set, serves the self-contained HTML portal", async () => {
  process.env["API_PORTAL_ENABLED"] = "1";
  try {
    const r = await h.req("/docs");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /html/);
    const html = await r.text();
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /OmniProject API/);
    assert.match(html, /\/api\/openapi\.yaml|\/api\/projects/); // a real route from the surface is listed
    // Self-contained: no external resource references (CSP-safe).
    assert.equal(/src="https?:|href="https?:/.test(html), false);
  } finally {
    delete process.env["API_PORTAL_ENABLED"];
  }
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
  // The portal is off by default, so discovery must NOT advertise a docs URL.
  assert.equal((body as { docs?: string }).docs, undefined);
});

test("GET /discovery advertises the portal URL only when API_PORTAL_ENABLED is set", async () => {
  process.env["API_PORTAL_ENABLED"] = "1";
  try {
    const r = await h.req("/discovery");
    const body = (await r.json()) as { docs?: string };
    assert.equal(body.docs, "https://omni.example.com/api/docs");
  } finally {
    delete process.env["API_PORTAL_ENABLED"];
  }
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
