import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

/**
 * Unit tests for premium licence fulfilment (lib/fulfillment): mapping a
 * purchased product → entitlement, minting an Ed25519-signed licence, and
 * delivering it to the fulfilment endpoint. fulfillment reads LICENSE_* from
 * process.env at CALL time (not import time), so we set the env per test and
 * restore it afterwards. Delivery uses a mocked globalThis.fetch — no network.
 */
const { entitlementForProduct, mintForPurchase, fulfilPurchase } = await import("../lib/fulfillment");
const { verifyLicense } = await import("../lib/license");

// Ed25519 key pair for signing/verifying minted licences.
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const PRIV_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PUB_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

const PRODUCTS = JSON.stringify({
  price_pro: { tier: "pro", features: ["branding", "labels"], days: 365 },
  ent_all: { tier: "enterprise", features: ["branding", "labels", "webhooks", "enterprise_workflows"], days: 30 },
});

const realFetch = globalThis.fetch;
const SAVED = {
  LICENSE_PRODUCTS: process.env["LICENSE_PRODUCTS"],
  LICENSE_PRIVATE_KEY: process.env["LICENSE_PRIVATE_KEY"],
  LICENSE_FULFILLMENT_URL: process.env["LICENSE_FULFILLMENT_URL"],
  LICENSE_FULFILLMENT_SECRET: process.env["LICENSE_FULFILLMENT_SECRET"],
};

function setEnv(env: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

afterEach(() => {
  globalThis.fetch = realFetch;
  setEnv(SAVED);
});

test("entitlementForProduct resolves a mapped product and filters unknown features", () => {
  setEnv({ LICENSE_PRODUCTS: JSON.stringify({ p1: { tier: "pro", features: ["branding", "bogus"], days: 10 } }) });
  const ent = entitlementForProduct("p1");
  assert.equal(ent?.tier, "pro");
  assert.deepEqual(ent?.features, ["branding"]); // "bogus" dropped
  assert.equal(ent?.days, 10);
});

test("entitlementForProduct returns null for an unmapped product", () => {
  setEnv({ LICENSE_PRODUCTS: PRODUCTS });
  assert.equal(entitlementForProduct("not-a-product"), null);
});

test("entitlementForProduct returns null when LICENSE_PRODUCTS is unset or invalid", () => {
  setEnv({ LICENSE_PRODUCTS: undefined });
  assert.equal(entitlementForProduct("price_pro"), null);
  setEnv({ LICENSE_PRODUCTS: "{not json" });
  assert.equal(entitlementForProduct("price_pro"), null);
});

test("entitlementForProduct applies tier/days defaults for sparse entries", () => {
  setEnv({ LICENSE_PRODUCTS: JSON.stringify({ p: {} }) });
  const ent = entitlementForProduct("p");
  assert.equal(ent?.tier, "licensed");
  assert.equal(ent?.days, 365);
  assert.deepEqual(ent?.features, []);
});

test("mintForPurchase errors when no private key is configured", () => {
  setEnv({ LICENSE_PRODUCTS: PRODUCTS, LICENSE_PRIVATE_KEY: undefined });
  const result = mintForPurchase({ provider: "stripe", productId: "price_pro", customer: "Ada" });
  assert.ok("error" in result);
  assert.match(result.error, /LICENSE_PRIVATE_KEY/);
});

test("mintForPurchase errors for an unmapped product", () => {
  setEnv({ LICENSE_PRODUCTS: PRODUCTS, LICENSE_PRIVATE_KEY: PRIV_PEM });
  const result = mintForPurchase({ provider: "stripe", productId: "nope", customer: "Ada" });
  assert.ok("error" in result);
  assert.match(result.error, /No entitlement mapping/);
});

test("mintForPurchase mints a licence that verifies against the public key", () => {
  setEnv({ LICENSE_PRODUCTS: PRODUCTS, LICENSE_PRIVATE_KEY: PRIV_PEM });
  const now = 1_700_000_000_000;
  const result = mintForPurchase({ provider: "stripe", productId: "price_pro", customer: "Ada", now });
  assert.ok(!("error" in result));
  const minted = result as { token: string; payload: { tier: string; exp?: number; iat: number } };
  assert.equal(minted.payload.tier, "pro");
  assert.equal(minted.payload.iat, Math.floor(now / 1000));
  assert.equal(minted.payload.exp, Math.floor(now / 1000) + 365 * 86400);

  const verified = verifyLicense(minted.token, PUB_PEM, now + 1000);
  assert.equal(verified.valid, true);
  assert.deepEqual(verified.payload?.features, ["branding", "labels"]);
});

test("fulfilPurchase fails (no delivery) when minting fails", async () => {
  setEnv({ LICENSE_PRODUCTS: PRODUCTS, LICENSE_PRIVATE_KEY: undefined });
  const result = await fulfilPurchase({ provider: "gumroad", productId: "price_pro", customer: "Ada" });
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /LICENSE_PRIVATE_KEY/);
});

test("fulfilPurchase mints but reports delivered:false when no fulfilment URL is set", async () => {
  setEnv({ LICENSE_PRODUCTS: PRODUCTS, LICENSE_PRIVATE_KEY: PRIV_PEM, LICENSE_FULFILLMENT_URL: undefined });
  const result = await fulfilPurchase({ provider: "stripe", productId: "ent_all", customer: "Ada", email: "a@t" });
  assert.equal(result.ok, true);
  assert.equal(result.delivered, false);
  assert.ok(result.licenseKey);
});

test("fulfilPurchase delivers the licence to the fulfilment URL with a signature", async () => {
  setEnv({
    LICENSE_PRODUCTS: PRODUCTS,
    LICENSE_PRIVATE_KEY: PRIV_PEM,
    LICENSE_FULFILLMENT_URL: "https://n8n.test/fulfil",
    LICENSE_FULFILLMENT_SECRET: "deliver-secret",
  });
  let captured: { url: string; headers: Headers; body: string } | null = null;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(url), headers: new Headers(init?.headers), body: String(init?.body) };
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  const result = await fulfilPurchase({
    provider: "stripe",
    productId: "ent_all",
    customer: "Ada",
    email: "a@t",
    orderId: "ord-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.delivered, true);
  assert.equal(result.deliveryStatus, 200);
  assert.equal(captured!.url, "https://n8n.test/fulfil");
  assert.ok(captured!.headers.get("x-omniproject-signature"));
  const body = JSON.parse(captured!.body);
  assert.equal(body.tier, "enterprise");
  assert.equal(body.orderId, "ord-1");
  assert.ok(body.licenseKey);
});

test("fulfilPurchase reports delivered:false when the endpoint errors", async () => {
  setEnv({
    LICENSE_PRODUCTS: PRODUCTS,
    LICENSE_PRIVATE_KEY: PRIV_PEM,
    LICENSE_FULFILLMENT_URL: "https://n8n.test/fulfil",
  });
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  const result = await fulfilPurchase({ provider: "gumroad", productId: "price_pro", customer: "Ada" });
  assert.equal(result.ok, true);
  assert.equal(result.delivered, false);
});
