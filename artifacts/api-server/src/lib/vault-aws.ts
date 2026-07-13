import { awsSignedHeaders, awsCredsFromEnv } from "./aws-sigv4";
import { safeFetch } from "./egress";
import type { VaultStore } from "./vault-store";

/**
 * AWS Secrets Manager vault store (native). All AI keys are held in ONE Secrets Manager
 * secret as a JSON ref→value map (so load is a single GetSecretValue and put/del are
 * read-modify-write). Requests are signed with AWS Signature V4 (lib/aws-sigv4) — no SDK.
 *
 * Credentials come from the environment (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY /
 * optional AWS_SESSION_TOKEN / AWS_REGION); the secret id is VAULT_AWS_SECRET_ID.
 */
const SERVICE = "secretsmanager";

/** Build a HashiCorp/registry-shaped VaultStore backed by AWS Secrets Manager. */
export function awsSecretsStore(): VaultStore {
  const { region, creds } = awsCredsFromEnv();
  const secretId = process.env["VAULT_AWS_SECRET_ID"]?.trim() || "omni-ai-vault";
  const host = `secretsmanager.${region}.amazonaws.com`;
  const endpoint = `https://${host}/`;

  // One signed POST to the Secrets Manager JSON API (X-Amz-Target selects the operation).
  const call = (target: string, payload: unknown): Promise<Response> => {
    const body = JSON.stringify(payload);
    const headers = awsSignedHeaders({ host, region, service: SERVICE, target, body, creds });
    // safeFetch, not bare fetch: every outbound hop — including a secret-backend call — passes the
    // SSRF/residency guard, pins the vetted IPs, and re-validates redirects (see lib/egress.ts). With
    // EGRESS_ALLOWLIST set, the Secrets Manager host must be listed (correct egress-pinning hygiene).
    return safeFetch(endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) });
  };

  const isNotFound = async (res: Response): Promise<boolean> => {
    const err = (await res.clone().json().catch(() => ({}))) as { __type?: string };
    return String(err.__type ?? "").includes("ResourceNotFoundException");
  };

  const read = async (): Promise<Record<string, string>> => {
    const res = await call("secretsmanager.GetSecretValue", { SecretId: secretId });
    if (res.status === 400 && (await isNotFound(res))) return {};
    if (!res.ok) throw new Error(`AWS GetSecretValue ${res.status}`);
    const json = (await res.json()) as { SecretString?: string };
    if (!json.SecretString) return {};
    try { return JSON.parse(json.SecretString) as Record<string, string>; } catch { return {}; }
  };

  const write = async (map: Record<string, string>): Promise<void> => {
    const SecretString = JSON.stringify(map);
    let res = await call("secretsmanager.PutSecretValue", { SecretId: secretId, SecretString });
    if (res.status === 400 && (await isNotFound(res))) {
      res = await call("secretsmanager.CreateSecret", { Name: secretId, SecretString });
    }
    if (!res.ok) throw new Error(`AWS PutSecretValue ${res.status}`);
  };

  return {
    id: "aws",
    load: read,
    async put(ref, value) { const m = await read(); m[ref] = value; await write(m); },
    async del(ref) { const m = await read(); if (ref in m) { delete m[ref]; await write(m); } },
  };
}
