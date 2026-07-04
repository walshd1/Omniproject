import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Agent } from "undici";
import { brokerDispatcher, brokerFetch, brokerMtlsConfigured, closeBrokerDispatcher } from "./broker-transport";

const FAKE_CERT = "-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----";
const FAKE_KEY = "-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----";

afterEach(async () => {
  delete process.env["BROKER_MTLS_CERT"];
  delete process.env["BROKER_MTLS_KEY"];
  delete process.env["BROKER_MTLS_CA"];
  delete process.env["BROKER_MTLS_INSECURE"];
  await closeBrokerDispatcher();
});

test("brokerMtlsConfigured is false with no env set, true once cert+key are both present", () => {
  assert.equal(brokerMtlsConfigured(), false);
  process.env["BROKER_MTLS_CERT"] = FAKE_CERT;
  assert.equal(brokerMtlsConfigured(), false); // cert alone isn't client auth
  process.env["BROKER_MTLS_KEY"] = FAKE_KEY;
  assert.equal(brokerMtlsConfigured(), true);
});

test("brokerDispatcher returns a real undici Agent and caches the instance across calls", () => {
  const a = brokerDispatcher();
  const b = brokerDispatcher();
  assert.ok(a instanceof Agent);
  assert.equal(a, b);
});

test("brokerDispatcher rebuilds when the mTLS env config changes", () => {
  const before = brokerDispatcher();
  process.env["BROKER_MTLS_CERT"] = FAKE_CERT;
  process.env["BROKER_MTLS_KEY"] = FAKE_KEY;
  const after = brokerDispatcher();
  assert.notEqual(before, after);
  assert.equal(brokerDispatcher(), after); // stable again once the config settles
});

test("BROKER_MTLS_CERT accepts base64-of-PEM (env-friendly, no embedded newlines)", () => {
  process.env["BROKER_MTLS_CERT"] = Buffer.from(FAKE_CERT, "utf8").toString("base64");
  process.env["BROKER_MTLS_KEY"] = FAKE_KEY;
  assert.equal(brokerMtlsConfigured(), true);
});

/**
 * Regression test for a real bug caught before it shipped: Node's GLOBAL `fetch` is powered by
 * whatever undici version ships inside that Node release, which can (and here, does) lag the
 * `undici` package installed from npm. Handing this module's Agent to the global `fetch` throws
 * at request time (`InvalidArgumentError: invalid onRequestStart method`) because the two
 * versions' internal dispatch-handler protocols aren't wire-compatible — a mismatch invisible to
 * both the type checker and a construction-only test. Only an end-to-end request against a real
 * socket, through `brokerFetch` (undici's own fetch, not the global one), would catch it.
 */
test("brokerFetch actually completes a request end-to-end through the custom dispatcher", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => server.listen(0, r));
  try {
    const port = (server.address() as AddressInfo).port;
    const res = await brokerFetch(`http://127.0.0.1:${port}`, { method: "GET", signal: AbortSignal.timeout(3000) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    server.close();
  }
});

test("closeBrokerDispatcher drops the cache so the next call builds a fresh Agent", async () => {
  const a = brokerDispatcher();
  await closeBrokerDispatcher();
  const b = brokerDispatcher();
  assert.notEqual(a, b);
});
