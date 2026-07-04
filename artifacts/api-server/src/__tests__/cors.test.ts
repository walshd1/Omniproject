import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * CORS over the REAL app: no origin is trusted by default (deny cross-origin reads); PUBLIC_URL
 * and CORS_ALLOWED_ORIGINS opt specific origins in. Requests carrying no Origin header (curl,
 * server-to-server, same-origin browser calls) are unaffected either way.
 */
process.env["SESSION_SECRET"] = "test-session-secret-cors";
process.env["NODE_ENV"] = "test";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["PUBLIC_URL"] = "https://omni.example.com";
process.env["CORS_ALLOWED_ORIGINS"] = "https://dash.example.com";
// A non-local PUBLIC_URL is itself a production signal, and no OIDC + RATE_LIMIT_DISABLED are
// now CRITICAL boot-refusing findings by default — opt out for this harness only.
process.env["SECURITY_STRICT"] = "off";

let server: Server;
let base: string;

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

test("an untrusted cross-origin caller gets no Access-Control-Allow-Origin header", async () => {
  const res = await fetch(`${base}/api/healthz`, { headers: { Origin: "https://evil.attacker.example" } });
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("PUBLIC_URL is trusted as a CORS origin", async () => {
  const res = await fetch(`${base}/api/healthz`, { headers: { Origin: "https://omni.example.com" } });
  assert.equal(res.headers.get("access-control-allow-origin"), "https://omni.example.com");
});

test("CORS_ALLOWED_ORIGINS entries are trusted too", async () => {
  const res = await fetch(`${base}/api/healthz`, { headers: { Origin: "https://dash.example.com" } });
  assert.equal(res.headers.get("access-control-allow-origin"), "https://dash.example.com");
});

test("a request with no Origin header (same-origin / curl) is unaffected", async () => {
  const res = await fetch(`${base}/api/healthz`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});
