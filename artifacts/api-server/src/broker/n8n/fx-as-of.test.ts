import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { updateSettings } from "../../lib/settings";
import type { ActorContext } from "../types";

// webhookPool() prefers getSettings().brokerUrl (frozen at module load) over the
// BROKER_URL env, so point the broker at the test server via settings too.
function pointBroker(url: string | null): void {
  updateSettings({ brokerUrl: url });
}

/**
 * The FX rate-source + as-of-date policy (settings.fxRatePolicy / fxRateAsOfDate) resolves,
 * client-side, to an `asOf` date that rides through GET /fx-rates → broker.fxRates(ctx, { asOf }).
 * Proves the n8n adapter actually forwards that hint on the wire (`get_fx_rates` payload.asOf), and
 * that a workflow's own `asOf` in the reply wins over the request's when both are present — still a
 * live read every time, nothing cached or stored.
 */
test("N8nBroker.fxRates: forwards opts.asOf as payload.asOf to the get_fx_rates action", async () => {
  const captured: unknown[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const body = JSON.parse(raw) as { action: string; payload: Record<string, unknown> };
      captured.push(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, data: { base: "GBP", rates: { GBP: 1, USD: 1.3 } }, message: null }));
    });
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  const port = (server.address() as AddressInfo).port;
  const prevUrl = process.env["BROKER_URL"];
  process.env["BROKER_URL"] = `http://127.0.0.1:${port}`;
  pointBroker(`http://127.0.0.1:${port}`);

  try {
    const { N8nBroker } = await import("./index");
    const broker = new N8nBroker();
    const ctx: ActorContext = { sub: "tester", email: "t@example.test", role: "admin", authHeader: "Bearer test" };

    const fx = await broker.fxRates(ctx, { asOf: "2026-06-30" });
    assert.equal(fx.provenance, "sourced");
    assert.equal(fx.base, "GBP");

    assert.equal(captured.length, 1);
    const body = captured[0] as { action: string; payload: Record<string, unknown> };
    assert.equal(body.action, "get_fx_rates");
    assert.equal(body.payload["asOf"], "2026-06-30");
  } finally {
    server.close();
    if (prevUrl === undefined) delete process.env["BROKER_URL"]; else process.env["BROKER_URL"] = prevUrl;
    pointBroker(prevUrl ?? null);
  }
});

test("N8nBroker.fxRates: no asOf hint when the policy is spot (opts omitted)", async () => {
  const captured: unknown[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      captured.push(JSON.parse(raw));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, data: { base: "GBP", rates: { GBP: 1 } }, message: null }));
    });
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  const port = (server.address() as AddressInfo).port;
  const prevUrl = process.env["BROKER_URL"];
  process.env["BROKER_URL"] = `http://127.0.0.1:${port}`;
  pointBroker(`http://127.0.0.1:${port}`);

  try {
    const { N8nBroker } = await import("./index");
    const broker = new N8nBroker();
    const ctx: ActorContext = { sub: "tester", email: "t@example.test", role: "admin", authHeader: "Bearer test" };

    await broker.fxRates(ctx);

    const body = captured[0] as { payload: Record<string, unknown> };
    assert.equal(body.payload["asOf"], undefined);
  } finally {
    server.close();
    if (prevUrl === undefined) delete process.env["BROKER_URL"]; else process.env["BROKER_URL"] = prevUrl;
    pointBroker(prevUrl ?? null);
  }
});
