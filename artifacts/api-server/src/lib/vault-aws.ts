import crypto from "node:crypto";
import type { VaultStore } from "./vault-store";

/**
 * AWS Secrets Manager vault store (native). All AI keys are held in ONE Secrets Manager
 * secret as a JSON ref→value map (so load is a single GetSecretValue and put/del are
 * read-modify-write). Requests are signed with AWS Signature V4 — no SDK, just fetch + the
 * crypto needed to sign.
 *
 * Credentials come from the environment (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY /
 * optional AWS_SESSION_TOKEN / AWS_REGION); the secret id is VAULT_AWS_SECRET_ID.
 */
const SERVICE = "secretsmanager";

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}
function sha256hex(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}
/** Derive the SigV4 signing key for a given date/region/service. */
function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), "aws4_request");
}

/** Build a HashiCorp/registry-shaped VaultStore backed by AWS Secrets Manager. */
export function awsSecretsStore(): VaultStore {
  const region = process.env["AWS_REGION"]?.trim() || "us-east-1";
  const accessKey = process.env["AWS_ACCESS_KEY_ID"]?.trim() || "";
  const secretKey = process.env["AWS_SECRET_ACCESS_KEY"]?.trim() || "";
  const sessionToken = process.env["AWS_SESSION_TOKEN"]?.trim();
  const secretId = process.env["VAULT_AWS_SECRET_ID"]?.trim() || "omni-ai-vault";
  const host = `secretsmanager.${region}.amazonaws.com`;
  const endpoint = `https://${host}/`;

  // One signed POST to the Secrets Manager JSON API (X-Amz-Target selects the operation).
  const call = (target: string, payload: unknown): Promise<Response> => {
    const body = JSON.stringify(payload);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const canonicalHeaders =
      `content-type:application/x-amz-json-1.1\n` +
      `host:${host}\n` +
      `x-amz-date:${amzDate}\n` +
      `x-amz-target:${target}\n`;
    const signedHeaders = "content-type;host;x-amz-date;x-amz-target";
    const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, sha256hex(body)].join("\n");
    const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
    const signature = hmac(signingKey(secretKey, dateStamp, region, SERVICE), stringToSign).toString("hex");
    const headers: Record<string, string> = {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Date": amzDate,
      "X-Amz-Target": target,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
    if (sessionToken) headers["X-Amz-Security-Token"] = sessionToken;
    return fetch(endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) });
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
