import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * HTTP-level coverage for GET /api/portfolio/financials — the server-side consolidation fan-out that
 * folds every project's financials into ONE reporting currency, rolled up by programme. Drives the REAL
 * Express app with the demo broker (which returns non-empty financials) so the endpoint is exercised
 * end-to-end, including the `?currency=` reporting-currency override.
 */
const SECRET = "test-session-secret-portfolio-financials";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "test";
process.env["RATE_LIMIT_DISABLED"] = "true";
delete process.env["OIDC_ISSUER_URL"]; // demo mode → every session is admin

function signedSessionCookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const SESSION = signedSessionCookie({ sub: "user-1", email: "u@test", roles: [] });

let server: Server;
let base: string;

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server?.close(); });

const get = (path: string) => fetch(`${base}${path}`, { headers: { cookie: SESSION } });

test("GET /api/portfolio/financials returns a consolidated roll-up", async () => {
  const res = await get("/api/portfolio/financials");
  assert.equal(res.status, 200);
  const body = await res.json() as {
    reportingCurrency: string;
    portfolio: { budget: number; actual: number; forecast: number; variance: number; projects: number };
    programmes: unknown[];
    currencyMix: unknown[];
    fx: { base: string } | null;
  };
  assert.equal(typeof body.reportingCurrency, "string");
  assert.ok(body.reportingCurrency.length > 0);
  assert.ok(Array.isArray(body.programmes), "programmes is an array");
  assert.ok(Array.isArray(body.currencyMix), "currencyMix is an array");
  // The demo broker reports financials for its projects, so the portfolio total is populated + numeric.
  assert.equal(typeof body.portfolio.budget, "number");
  assert.equal(typeof body.portfolio.variance, "number");
  assert.ok(body.portfolio.projects > 0, "at least one project folded into the portfolio total");
});

test("?currency= overrides the reporting currency", async () => {
  const res = await get("/api/portfolio/financials?currency=USD");
  assert.equal(res.status, 200);
  const body = await res.json() as { reportingCurrency: string };
  assert.equal(body.reportingCurrency, "USD");
});

test("an implausible ?currency= value is ignored (falls back to the default)", async () => {
  const res = await get("/api/portfolio/financials?currency=not-a-code!!");
  assert.equal(res.status, 200);
  const body = await res.json() as { reportingCurrency: string };
  assert.notEqual(body.reportingCurrency, "not-a-code!!");
});
