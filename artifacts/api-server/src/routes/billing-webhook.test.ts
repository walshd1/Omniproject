import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Border test for POST /api/invoices/ninja-webhook — the SESSION-LESS inbound settlement callback.
 * The security-critical property is that it is reachable WITHOUT a user session (mounted outside
 * requireAuth) yet still rejects anything but the shared webhook secret. The paid-transition logic
 * itself is unit-tested (invoice / invoice-ninja specs); here we prove the auth wall + mounting.
 */
const SECRET = "test-ninja-webhook-secret";
process.env["INVOICE_NINJA_SYNC"] = "1";
process.env["INVOICE_NINJA_WEBHOOK_SECRET"] = SECRET;
process.env["SESSION_SECRET"] = "test-session-secret-ninja-webhook";
process.env["RATE_LIMIT_DISABLED"] = "true";

let server: Server;
let base: string;

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/invoices/ninja-webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

test("rejects a request with no secret (401) — proving the route is guarded, not open", async () => {
  const res = await post({ custom_value1: "omni:org~inv1" });
  assert.equal(res.status, 401);
});

test("rejects a wrong secret (401) — NOT an auth-wall redirect, so it is reachable session-less", async () => {
  const res = await post({ custom_value1: "omni:org~inv1" }, { authorization: "Bearer wrong" });
  assert.equal(res.status, 401);
});

test("a valid secret passes the auth wall (not 401/403) — an unknown/empty payload is 404 or 422, never an auth error", async () => {
  const noCorrelation = await post({ status_id: "4" }, { authorization: `Bearer ${SECRET}` });
  assert.notEqual(noCorrelation.status, 401);
  assert.notEqual(noCorrelation.status, 403);
  assert.ok([404, 422].includes(noCorrelation.status), `expected 404/422, got ${noCorrelation.status}`);

  // A well-formed correlation for an invoice that doesn't exist → 404 (never an auth failure).
  const unknownInvoice = await post({ custom_value1: "omni:org~does-not-exist" }, { "x-invoice-ninja-secret": SECRET });
  assert.notEqual(unknownInvoice.status, 401);
  assert.equal(unknownInvoice.status, 404);
});
