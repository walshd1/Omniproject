import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { azureKeyVaultStore } from "./vault-azure";

/**
 * Azure Key Vault vault store — all keys held in one Key Vault secret as a JSON map.
 * Exercised against a mocked fetch (AAD token, then the secret GET/PUT).
 */
const realFetch = globalThis.fetch;
const ENV = ["VAULT_AZURE_VAULT_URL", "AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "VAULT_AZURE_SECRET_NAME"];

beforeEach(() => {
  process.env["VAULT_AZURE_VAULT_URL"] = "https://kv.vault.azure.net/";
  process.env["AZURE_TENANT_ID"] = "tenant";
  process.env["AZURE_CLIENT_ID"] = "client";
  process.env["AZURE_CLIENT_SECRET"] = "secret";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV) delete process.env[k];
});

/** Install a fetch that returns an AAD token, then defers the secret GET/PUT to `handler`. */
function mockVault(handler: (url: string, init?: RequestInit) => Response): { calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(u.split("?")[0]!);
    if (u.includes("login.microsoftonline.com")) {
      return new Response(JSON.stringify({ access_token: "aad-token" }), { status: 200 });
    }
    return handler(u, init);
  }) as typeof fetch;
  return { calls };
}

test("load: parses the JSON map from the secret value", async () => {
  mockVault(() => new Response(JSON.stringify({ value: JSON.stringify({ "openai:default": "sk-1" }) }), { status: 200 }));
  const store = azureKeyVaultStore();
  assert.equal(store.id, "azure");
  assert.deepEqual(await store.load(), { "openai:default": "sk-1" });
});

test("load: a 404 secret is an empty map", async () => {
  mockVault(() => new Response("", { status: 404 }));
  assert.deepEqual(await azureKeyVaultStore().load(), {});
});

test("load: a secret with no value field is an empty map", async () => {
  mockVault(() => new Response(JSON.stringify({}), { status: 200 }));
  assert.deepEqual(await azureKeyVaultStore().load(), {});
});

test("load: a non-JSON secret value degrades to an empty map", async () => {
  mockVault(() => new Response(JSON.stringify({ value: "not json {" }), { status: 200 }));
  assert.deepEqual(await azureKeyVaultStore().load(), {});
});

test("load: a non-ok read (not 404) throws", async () => {
  mockVault(() => new Response("boom", { status: 500 }));
  await assert.rejects(() => azureKeyVaultStore().load(), /Azure Key Vault read 500/);
});

test("token acquisition failure surfaces as an error", async () => {
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).includes("login.microsoftonline.com")) return new Response("nope", { status: 401 });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  await assert.rejects(() => azureKeyVaultStore().load(), /Azure AAD token 401/);
});

test("put: reads the current map then writes it back with the new ref", async () => {
  let written: unknown = null;
  const { calls } = mockVault((u, init) => {
    if (init?.method === "PUT") {
      written = JSON.parse(String(init.body));
      return new Response("", { status: 200 });
    }
    return new Response(JSON.stringify({ value: JSON.stringify({ a: "1" }) }), { status: 200 });
  });
  await azureKeyVaultStore().put("b", "2");
  assert.deepEqual(JSON.parse((written as { value: string }).value), { a: "1", b: "2" });
  assert.ok(calls.some((c) => c.endsWith("/secrets/omni-ai-vault")));
});

test("put: a non-ok write throws", async () => {
  mockVault((u, init) =>
    init?.method === "PUT"
      ? new Response("err", { status: 403 })
      : new Response(JSON.stringify({ value: JSON.stringify({}) }), { status: 200 }),
  );
  await assert.rejects(() => azureKeyVaultStore().put("x", "y"), /Azure Key Vault write 403/);
});

test("del: removes an existing ref and writes back; absent ref is a no-op (no write)", async () => {
  let writes = 0;
  mockVault((u, init) => {
    if (init?.method === "PUT") {
      writes += 1;
      return new Response("", { status: 200 });
    }
    return new Response(JSON.stringify({ value: JSON.stringify({ keep: "1", drop: "2" }) }), { status: 200 });
  });
  await azureKeyVaultStore().del("drop");
  assert.equal(writes, 1);
  await azureKeyVaultStore().del("missing");
  assert.equal(writes, 1, "deleting an absent ref performs no write");
});

test("uses a custom secret name when configured", async () => {
  process.env["VAULT_AZURE_SECRET_NAME"] = "my-secret";
  const { calls } = mockVault(() => new Response(JSON.stringify({ value: JSON.stringify({}) }), { status: 200 }));
  await azureKeyVaultStore().load();
  assert.ok(calls.some((c) => c.endsWith("/secrets/my-secret")));
});
