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

test("http store fronts a generic REST secrets API (also used for aws/azure)", async () => {
  process.env["VAULT_BACKEND"] = "aws"; // routed through the generic http contract
  process.env["VAULT_HTTP_URL"] = "https://secrets.example";
  process.env["VAULT_HTTP_TOKEN"] = "bearer-x";
  const calls: Array<{ url: string; method: string; auth?: string }> = [];
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
