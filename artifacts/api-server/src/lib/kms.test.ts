import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { unwrapDataKey, initKms, kmsVaultKey, kmsEnabled, kmsProvider, __resetKms } from "./kms";

/**
 * KMS / BYOK unwrap for the vault root key. External providers are exercised against a mocked
 * fetch; "local" is a dev passthrough.
 */
const realFetch = globalThis.fetch;
const KEYS = ["KMS_PROVIDER", "VAULT_KEY_ENC", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "VAULT_KMS_KEY_URL", "AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"];
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of KEYS) delete process.env[k];
  __resetKms();
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
  let captured: { url: string; target?: string; auth?: string; body?: string } = { url: "" };
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    captured = { url: String(url), target: headers.get("X-Amz-Target") ?? undefined, auth: headers.get("Authorization") ?? undefined, body: String(init?.body) };
    return new Response(JSON.stringify({ Plaintext: KEY32.toString("base64") }), { status: 200 });
  }) as typeof fetch;

  const key = await unwrapDataKey("Q2lwaGVydGV4dA==");
  assert.deepEqual(key, KEY32);
  assert.match(captured.url, /kms\.eu-west-1\.amazonaws\.com/);
  assert.equal(captured.target, "TrentService.Decrypt");
  assert.match(captured.auth!, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/.*\/eu-west-1\/kms\/aws4_request/);
  assert.match(captured.body!, /CiphertextBlob/);
});

test("azure provider gets an AAD token then calls key decrypt", async () => {
  process.env["KMS_PROVIDER"] = "azure";
  process.env["VAULT_KMS_KEY_URL"] = "https://kv.vault.azure.net/keys/k/abc";
  process.env["AZURE_TENANT_ID"] = "t";
  process.env["AZURE_CLIENT_ID"] = "c";
  process.env["AZURE_CLIENT_SECRET"] = "s";
  const seen: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    seen.push(u.split("?")[0]!);
    if (u.includes("login.microsoftonline.com")) return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
    return new Response(JSON.stringify({ value: KEY32.toString("base64url") }), { status: 200 });
  }) as typeof fetch;

  const key = await unwrapDataKey(Buffer.from("ciphertext").toString("base64"));
  assert.deepEqual(key, KEY32);
  assert.ok(seen.some((s) => s.includes("login.microsoftonline.com")));
  assert.ok(seen.some((s) => s.endsWith("/keys/k/abc/decrypt")));
});
