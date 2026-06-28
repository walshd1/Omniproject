import type { VaultStore } from "./vault-store";

/**
 * Azure Key Vault vault store (native). All AI keys are held in ONE Key Vault secret as a
 * JSON ref→value map (load is a single GET; put/del are read-modify-write) — which also
 * sidesteps Key Vault's restrictive secret-name charset. Auth is the AAD client-credentials
 * flow (no SDK, just fetch).
 *
 * Config from the environment: VAULT_AZURE_VAULT_URL (e.g. https://myvault.vault.azure.net),
 * AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET, and VAULT_AZURE_SECRET_NAME.
 */
const API_VERSION = "7.4";

/** Build a registry-shaped VaultStore backed by Azure Key Vault. */
export function azureKeyVaultStore(): VaultStore {
  const vaultUrl = (process.env["VAULT_AZURE_VAULT_URL"]?.trim() || "").replace(/\/$/, "");
  const tenant = process.env["AZURE_TENANT_ID"]?.trim() || "";
  const clientId = process.env["AZURE_CLIENT_ID"]?.trim() || "";
  const clientSecret = process.env["AZURE_CLIENT_SECRET"]?.trim() || "";
  const secretName = process.env["VAULT_AZURE_SECRET_NAME"]?.trim() || "omni-ai-vault";

  // AAD OAuth2 client-credentials token scoped to the Key Vault data plane.
  const token = async (): Promise<string> => {
    const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "https://vault.azure.net/.default",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Azure AAD token ${res.status}`);
    return ((await res.json()) as { access_token?: string }).access_token ?? "";
  };

  const secretUrl = () => `${vaultUrl}/secrets/${secretName}?api-version=${API_VERSION}`;

  const read = async (): Promise<Record<string, string>> => {
    const res = await fetch(secretUrl(), { headers: { Authorization: `Bearer ${await token()}` }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return {};
    if (!res.ok) throw new Error(`Azure Key Vault read ${res.status}`);
    const json = (await res.json()) as { value?: string };
    if (!json.value) return {};
    try { return JSON.parse(json.value) as Record<string, string>; } catch { return {}; }
  };

  const write = async (map: Record<string, string>): Promise<void> => {
    const res = await fetch(secretUrl(), {
      method: "PUT",
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ value: JSON.stringify(map) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Azure Key Vault write ${res.status}`);
  };

  return {
    id: "azure",
    load: read,
    async put(ref, value) { const m = await read(); m[ref] = value; await write(m); },
    async del(ref) { const m = await read(); if (ref in m) { delete m[ref]; await write(m); } },
  };
}
