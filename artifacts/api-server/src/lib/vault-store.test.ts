import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { activeVaultStore, vaultBackendId, VAULT_BACKENDS } from "./vault-store";

/**
 * Vault storage seam: pick the backend with VAULT_BACKEND. Local is the default; HashiCorp/
 * HCP and a generic HTTP store (which also fronts AWS/Azure) are external adapters. External
 * adapters are exercised against a mocked fetch — no real network.
 */
const realFetch = globalThis.fetch;
const ORIGINAL_BACKEND = process.env["VAULT_BACKEND"];

afterEach(() => {
  globalThis.fetch = realFetch;
  if (ORIGINAL_BACKEND === undefined) delete process.env["VAULT_BACKEND"];
  else process.env["VAULT_BACKEND"] = ORIGINAL_BACKEND;
  for (const k of [
    "VAULT_ADDR", "VAULT_TOKEN", "VAULT_HTTP_URL", "VAULT_HTTP_TOKEN",
    "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
    "VAULT_AZURE_VAULT_URL", "AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET",
  ]) delete process.env[k];
});

test("defaults to the local backend; registry includes the external stores", () => {
  delete process.env["VAULT_BACKEND"];
  assert.equal(vaultBackendId(), "local");
  assert.equal(activeVaultStore().id, "local");
  for (const id of ["local", "hashicorp", "hcp", "http", "aws", "azure"]) {
    assert.ok(VAULT_BACKENDS.includes(id), id);
  }
});

test("an unknown VAULT_BACKEND falls back to local (fail-safe)", () => {
  process.env["VAULT_BACKEND"] = "does-not-exist";
  assert.equal(vaultBackendId(), "local");
});

test("hcp resolves to the HashiCorp adapter", () => {
  process.env["VAULT_BACKEND"] = "hcp";
  assert.equal(activeVaultStore().id, "hashicorp");
});

test("hashicorp store reads the KV v2 map and writes via read-modify-write", async () => {
  process.env["VAULT_BACKEND"] = "hashicorp";
  process.env["VAULT_ADDR"] = "https://vault.example:8200";
  process.env["VAULT_TOKEN"] = "t";
  const calls: Array<{ url: string; method: string }> = [];
  let stored: Record<string, string> = { "aiprovider:openai": "sk-existing" };
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url: String(url), method });
    if (method === "GET") return new Response(JSON.stringify({ data: { data: stored } }), { status: 200 });
    stored = (JSON.parse(String(init?.body)) as { data: Record<string, string> }).data;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const store = activeVaultStore();
  assert.deepEqual(await store.load(), { "aiprovider:openai": "sk-existing" });
  await store.put("aiprovider:anthropic", "sk-new");
  assert.equal(stored["aiprovider:anthropic"], "sk-new");
  assert.equal(stored["aiprovider:openai"], "sk-existing"); // read-modify-write preserved it
  assert.ok(calls.some((c) => c.url.includes("/v1/secret/data/omni-ai-vault")));
});

test("http store fronts a generic REST secrets API", async () => {
  process.env["VAULT_BACKEND"] = "http";
  process.env["VAULT_HTTP_URL"] = "https://secrets.example";
  process.env["VAULT_HTTP_TOKEN"] = "bearer-x";
  const calls: Array<{ url: string; method: string; auth?: string | undefined }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), method: (init?.method ?? "GET").toUpperCase(), auth: headers.get("Authorization") ?? undefined });
    if ((init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ "aiprovider:openai": "sk" }), { status: 200 });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const store = activeVaultStore();
  assert.equal(store.id, "http");
  assert.deepEqual(await store.load(), { "aiprovider:openai": "sk" });
  await store.put("aiprovider:x", "v");
  await store.del("aiprovider:x");
  assert.equal(calls[0]!.auth, "Bearer bearer-x");
  assert.ok(calls.some((c) => c.method === "PUT" && c.url.endsWith("/secrets/aiprovider%3Ax")));
  assert.ok(calls.some((c) => c.method === "DELETE"));
});

test("aws store signs with SigV4 and read-modify-writes one Secrets Manager secret", async () => {
  process.env["VAULT_BACKEND"] = "aws";
  process.env["AWS_REGION"] = "eu-west-2";
  process.env["AWS_ACCESS_KEY_ID"] = "AKIDEXAMPLE";
  process.env["AWS_SECRET_ACCESS_KEY"] = "secret";
  delete process.env["AWS_SESSION_TOKEN"];
  const calls: Array<{ target: string; auth: string; body: unknown }> = [];
  let stored: Record<string, string> = { "aiprovider:openai": "sk-existing" };
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const target = headers.get("X-Amz-Target") ?? "";
    const body = JSON.parse(String(init?.body));
    calls.push({ target, auth: headers.get("Authorization") ?? "", body });
    if (target.endsWith("GetSecretValue")) return new Response(JSON.stringify({ SecretString: JSON.stringify(stored) }), { status: 200 });
    if (target.endsWith("PutSecretValue")) { stored = JSON.parse(body.SecretString); return new Response("{}", { status: 200 }); }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const store = activeVaultStore();
  assert.equal(store.id, "aws");
  assert.deepEqual(await store.load(), { "aiprovider:openai": "sk-existing" });
  await store.put("aiprovider:anthropic", "sk-new");
  assert.equal(stored["aiprovider:anthropic"], "sk-new");
  assert.equal(stored["aiprovider:openai"], "sk-existing"); // read-modify-write preserved it
  // Every call carries a SigV4 Authorization for the secretsmanager service in the region.
  assert.ok(calls.every((c) => c.auth.startsWith("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/")));
  assert.ok(calls.every((c) => c.auth.includes("/eu-west-2/secretsmanager/aws4_request")));
});

test("aws store creates the secret on first write when it doesn't exist", async () => {
  process.env["VAULT_BACKEND"] = "aws";
  process.env["AWS_ACCESS_KEY_ID"] = "AKIDEXAMPLE";
  process.env["AWS_SECRET_ACCESS_KEY"] = "secret";
  const targets: string[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const target = new Headers(init?.headers).get("X-Amz-Target") ?? "";
    targets.push(target);
    if (target.endsWith("GetSecretValue")) return new Response(JSON.stringify({ __type: "ResourceNotFoundException" }), { status: 400 });
    if (target.endsWith("PutSecretValue")) return new Response(JSON.stringify({ __type: "ResourceNotFoundException" }), { status: 400 });
    return new Response("{}", { status: 200 }); // CreateSecret
  }) as typeof fetch;

  await activeVaultStore().put("aiprovider:openai", "sk");
  assert.ok(targets.some((t) => t.endsWith("CreateSecret")));
});

test("azure store gets an AAD token then read-modify-writes one Key Vault secret", async () => {
  process.env["VAULT_BACKEND"] = "azure";
  process.env["VAULT_AZURE_VAULT_URL"] = "https://kv.vault.azure.net";
  process.env["AZURE_TENANT_ID"] = "tenant";
  process.env["AZURE_CLIENT_ID"] = "client";
  process.env["AZURE_CLIENT_SECRET"] = "secret";
  const seen: string[] = [];
  let stored: Record<string, string> = { "aiprovider:openai": "sk-existing" };
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    seen.push(`${method} ${u.split("?")[0]}`);
    if (u.includes("login.microsoftonline.com")) return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
    if (u.includes("/secrets/omni-ai-vault") && method === "GET") return new Response(JSON.stringify({ value: JSON.stringify(stored) }), { status: 200 });
    if (u.includes("/secrets/omni-ai-vault") && method === "PUT") { stored = JSON.parse((JSON.parse(String(init?.body)) as { value: string }).value); return new Response("{}", { status: 200 }); }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const store = activeVaultStore();
  assert.equal(store.id, "azure");
  assert.deepEqual(await store.load(), { "aiprovider:openai": "sk-existing" });
  await store.put("aiprovider:anthropic", "sk-new");
  assert.equal(stored["aiprovider:anthropic"], "sk-new");
  assert.equal(stored["aiprovider:openai"], "sk-existing");
  assert.ok(seen.some((s) => s.includes("login.microsoftonline.com")));
  assert.ok(seen.some((s) => s.startsWith("PUT https://kv.vault.azure.net/secrets/omni-ai-vault")));
});
