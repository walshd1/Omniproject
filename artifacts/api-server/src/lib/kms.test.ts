import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { __setEgressTransportForTest, __setEgressLookupForTest, type LookupFn } from "./egress";
// The vault/KMS stores call safeFetch with no injectable lookup, so route them to a test transport +
// a deterministic resolver: the egress guard still runs, but no real DNS/network is hit.
const BENIGN_LOOKUP = (async () => [{ address: "93.184.216.34", family: 4 }]) as LookupFn;
function mockEgress(fn: typeof fetch): void { __setEgressLookupForTest(BENIGN_LOOKUP); __setEgressTransportForTest(fn); }
import { unwrapDataKey, initKms, kmsVaultKey, kmsConfigKey, kmsEnabled, kmsProvider, __resetKms } from "./kms";
import { sealConfig, openConfig, __resetConfigCrypto } from "./config-crypto";

/**
 * KMS / BYOK unwrap for the vault root key. External providers are exercised against a mocked
 * fetch; "local" is a dev passthrough.
 */
const KEYS = ["KMS_PROVIDER", "VAULT_KEY_ENC", "CONFIG_KEY_ENC", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "VAULT_KMS_KEY_URL", "AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"];
afterEach(() => {
  __setEgressTransportForTest(null);
  __setEgressLookupForTest(null);
  for (const k of KEYS) delete process.env[k];
  __resetKms();
  __resetConfigCrypto();
});

const KEY32 = Buffer.alloc(32, 7); // a deterministic 32-byte "key"

test("defaults to no KMS", () => {
  assert.equal(kmsProvider(), "none");
  assert.equal(kmsEnabled(), false);
});

test("local provider is a base64 passthrough (dev)", async () => {
  process.env["KMS_PROVIDER"] = "local";
  const key = await unwrapDataKey(KEY32.toString("base64"));
  assert.deepEqual(key, KEY32);
});

test("initKms unwraps VAULT_KEY_ENC and caches it for the vault", async () => {
  process.env["KMS_PROVIDER"] = "local";
  process.env["VAULT_KEY_ENC"] = KEY32.toString("base64");
  assert.equal(kmsEnabled(), true);
  await initKms();
  assert.deepEqual(kmsVaultKey(), KEY32);
});

test("initKms unwraps CONFIG_KEY_ENC and config-crypto seals/opens under it", async () => {
  process.env["KMS_PROVIDER"] = "local";
  process.env["CONFIG_KEY_ENC"] = KEY32.toString("base64");
  await initKms();
  assert.deepEqual(kmsConfigKey(), KEY32);
  // A config token sealed now is readable now (round-trip under the KMS-provided key).
  const token = sealConfig("hello-config");
  assert.equal(openConfig(token), "hello-config");
  // After dropping the KMS key, the token no longer opens (it was sealed under a different key).
  __resetKms();
  __resetConfigCrypto();
  assert.equal(openConfig(token), null);
});

test("a non-32-byte unwrapped key is rejected (falls back, no cache)", async () => {
  process.env["KMS_PROVIDER"] = "local";
  process.env["VAULT_KEY_ENC"] = Buffer.alloc(16, 1).toString("base64"); // wrong length
  await initKms();
  assert.equal(kmsVaultKey(), null);
});

test("aws provider calls KMS Decrypt with a SigV4 Authorization", async () => {
  process.env["KMS_PROVIDER"] = "aws";
  process.env["AWS_REGION"] = "eu-west-1";
  process.env["AWS_ACCESS_KEY_ID"] = "AKIDEXAMPLE";
  process.env["AWS_SECRET_ACCESS_KEY"] = "secret";
  let captured: { url: string; target?: string | undefined; auth?: string | undefined; body?: string | undefined } = { url: "" };
  mockEgress((async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    captured = { url: String(url), target: headers.get("X-Amz-Target") ?? undefined, auth: headers.get("Authorization") ?? undefined, body: String(init?.body) };
    return new Response(JSON.stringify({ Plaintext: KEY32.toString("base64") }), { status: 200 });
  }) as typeof fetch);

  const key = await unwrapDataKey("Q2lwaGVydGV4dA==");
  assert.deepEqual(key, KEY32);
  assert.match(captured.url, /kms\.eu-west-1\.amazonaws\.com/);
  assert.equal(captured.target, "TrentService.Decrypt");
  assert.match(captured.auth!, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/.*\/eu-west-1\/kms\/aws4_request/);
  assert.match(captured.body!, /CiphertextBlob/);
});

test("unwrapDataKey throws when no KMS provider is configured", async () => {
  await assert.rejects(() => unwrapDataKey("anything"), /KMS_PROVIDER is not set/);
});

test("initKms is a no-op when KMS is disabled and is idempotent", async () => {
  await initKms(); // disabled → returns early, nothing cached
  assert.equal(kmsVaultKey(), null);
  assert.equal(kmsConfigKey(), null);

  // Enable AFTER the first init: the idempotency guard means it stays uninitialised.
  process.env["KMS_PROVIDER"] = "local";
  process.env["VAULT_KEY_ENC"] = KEY32.toString("base64");
  await initKms();
  assert.equal(kmsVaultKey(), null, "already-initialised guard prevents a second resolve");
});

test("aws: a non-ok KMS response throws", async () => {
  process.env["KMS_PROVIDER"] = "aws";
  process.env["AWS_REGION"] = "eu-west-1";
  process.env["AWS_ACCESS_KEY_ID"] = "AKID";
  process.env["AWS_SECRET_ACCESS_KEY"] = "s";
  mockEgress((async () => new Response("denied", { status: 400 })) as typeof fetch);
  await assert.rejects(() => unwrapDataKey("Q2lwaGVy"), /AWS KMS Decrypt 400/);
});

test("aws: a response with no Plaintext throws", async () => {
  process.env["KMS_PROVIDER"] = "aws";
  process.env["AWS_REGION"] = "eu-west-1";
  process.env["AWS_ACCESS_KEY_ID"] = "AKID";
  process.env["AWS_SECRET_ACCESS_KEY"] = "s";
  mockEgress((async () => new Response(JSON.stringify({}), { status: 200 })) as typeof fetch);
  await assert.rejects(() => unwrapDataKey("Q2lwaGVy"), /returned no plaintext/);
});

test("azure: an AAD token failure throws", async () => {
  process.env["KMS_PROVIDER"] = "azure";
  process.env["VAULT_KMS_KEY_URL"] = "https://kv.vault.azure.net/keys/k/abc";
  process.env["AZURE_TENANT_ID"] = "t";
  mockEgress((async () => new Response("no", { status: 401 })) as typeof fetch);
  await assert.rejects(() => unwrapDataKey(Buffer.from("c").toString("base64")), /Azure AAD token 401/);
});

test("azure: a non-ok decrypt throws; a decrypt with no value throws", async () => {
  process.env["KMS_PROVIDER"] = "azure";
  process.env["VAULT_KMS_KEY_URL"] = "https://kv.vault.azure.net/keys/k/abc/"; // trailing slash trimmed
  process.env["AZURE_TENANT_ID"] = "t";
  const token = () => new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });

  mockEgress((async (url: string | URL | Request) =>
    String(url).includes("login.microsoftonline.com") ? token() : new Response("err", { status: 500 })) as typeof fetch);
  await assert.rejects(() => unwrapDataKey(Buffer.from("c").toString("base64")), /Azure Key Vault decrypt 500/);

  mockEgress((async (url: string | URL | Request) =>
    String(url).includes("login.microsoftonline.com") ? token() : new Response(JSON.stringify({}), { status: 200 })) as typeof fetch);
  await assert.rejects(() => unwrapDataKey(Buffer.from("c").toString("base64")), /returned no value/);
});

test("azure provider gets an AAD token then calls key decrypt", async () => {
  process.env["KMS_PROVIDER"] = "azure";
  process.env["VAULT_KMS_KEY_URL"] = "https://kv.vault.azure.net/keys/k/abc";
  process.env["AZURE_TENANT_ID"] = "t";
  process.env["AZURE_CLIENT_ID"] = "c";
  process.env["AZURE_CLIENT_SECRET"] = "s";
  const seen: string[] = [];
  mockEgress((async (url: string | URL | Request) => {
    const u = String(url);
    seen.push(u.split("?")[0]!);
    if (u.includes("login.microsoftonline.com")) return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
    return new Response(JSON.stringify({ value: KEY32.toString("base64url") }), { status: 200 });
  }) as typeof fetch);

  const key = await unwrapDataKey(Buffer.from("ciphertext").toString("base64"));
  assert.deepEqual(key, KEY32);
  assert.ok(seen.some((s) => s.includes("login.microsoftonline.com")));
  assert.ok(seen.some((s) => s.endsWith("/keys/k/abc/decrypt")));
});
