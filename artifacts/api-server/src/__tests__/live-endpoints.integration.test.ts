import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { unwrapDataKey, kmsProvider } from "../lib/kms";
import { awsSecretsStore } from "../lib/vault-aws";
import { azureKeyVaultStore } from "../lib/vault-azure";
import { awsSignedHeaders, awsCredsFromEnv } from "../lib/aws-sigv4";
import { coreMetrics, toOtlpMetricsPayload, otlpMetricsEndpoint, exportMetricsOnce } from "../lib/otlp-metrics";

/**
 * OPT-IN LIVE-ENDPOINT INTEGRATION TESTS — external secret/KMS + telemetry round-trips.
 *
 * These exercise the REAL network seams that the rest of the suite only mock-verifies
 * (kms.test.ts, vault-aws.test.ts, vault-azure.test.ts, otlp-metrics.test.ts). They talk to
 * live or emulated infrastructure (AWS/Azure/Vault/an OTLP collector, or localstack / azurite /
 * vault-dev / an otel-collector), so EACH test SKIPS unless its gating env var is set. With the
 * gates unset — the normal `test` / CI `verify` lane, and this sandbox — every test here skips
 * and NOTHING makes a network call.
 *
 * This file matches the default test glob (src/**​/*.test.ts) and is therefore picked up by
 * `test` / `test:coverage`, but with the gates unset it all-skips (0 failures) and is excluded
 * from coverage by .c8rc.json (exclude: src/**​/*.test.ts), so it cannot tank coverage. Run it
 * ON ITS OWN in a dedicated CI stage with `pnpm --filter @workspace/api-server test:integration:live`.
 *
 * ── Required env per test (set to opt in; each also needs its provider's auth) ──────────────
 *
 * KMS wrap→unwrap  (real KMS Encrypt then the module's Decrypt/unwrap):
 *   KMS_PROVIDER            aws | azure | local   — selects + activates the provider
 *   aws:   AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (+ optional AWS_SESSION_TOKEN),
 *          LIVE_KMS_KEY_ID  — the KMS key id/ARN/alias to Encrypt the test data key under
 *   azure: VAULT_KMS_KEY_URL (.../keys/<name>/<ver>), AZURE_TENANT_ID, AZURE_CLIENT_ID,
 *          AZURE_CLIENT_SECRET
 *   local: none (dev base64 passthrough — proves the envelope path, not a network call)
 *
 * AWS Secrets Manager store→fetch→delete:
 *   VAULT_AWS_SECRET_ID     — the Secrets Manager secret id/name to use (gates the test)
 *   AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (+ optional AWS_SESSION_TOKEN)
 *
 * Azure Key Vault store→fetch→delete:
 *   VAULT_AZURE_VAULT_URL   — e.g. https://myvault.vault.azure.net (gates the test)
 *   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET (+ optional VAULT_AZURE_SECRET_NAME)
 *
 * OTLP metrics export:
 *   OTEL_EXPORTER_OTLP_ENDPOINT — the collector base URL, e.g. http://localhost:4318 (gates it)
 *   OTEL_EXPORTER_OTLP_HEADERS  — optional "k=v,k2=v2" auth headers
 *   OTEL_SERVICE_NAME           — optional service.name (default omniproject-gateway)
 *
 * NOTE: the vault + KMS-Encrypt tests MUTATE the target store/key (they add then remove a
 * uniquely-named test ref, preserving any other secrets via the store's read-modify-write).
 */

const DATA_KEY = () => crypto.randomBytes(32);
const testRef = (tag: string) => `omni-live-integration:${tag}:${process.pid}:${Date.now()}`;

// ── KMS: wrap (real Encrypt) → unwrap (module Decrypt) round-trip ────────────────────────────

/** Wrap a plaintext data key under AWS KMS (TrentService.Encrypt), returning the base64 CiphertextBlob. */
async function awsKmsEncrypt(keyId: string, plaintext: Buffer): Promise<string> {
  const { region, creds } = awsCredsFromEnv();
  const host = `kms.${region}.amazonaws.com`;
  const body = JSON.stringify({ KeyId: keyId, Plaintext: plaintext.toString("base64") });
  const headers = awsSignedHeaders({ host, region, service: "kms", target: "TrentService.Encrypt", body, creds });
  const res = await fetch(`https://${host}/`, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) });
  assert.ok(res.ok, `AWS KMS Encrypt HTTP ${res.status}`);
  const json = (await res.json()) as { CiphertextBlob?: string };
  assert.ok(json.CiphertextBlob, "AWS KMS Encrypt returned no CiphertextBlob");
  return json.CiphertextBlob;
}

/** Wrap a plaintext data key under an Azure Key Vault key (RSA-OAEP-256), returning STANDARD base64
 *  ciphertext (the shape kms.ts#azureUnwrap expects). */
async function azureKvEncrypt(plaintext: Buffer): Promise<string> {
  const keyUrl = (process.env["VAULT_KMS_KEY_URL"]?.trim() || "").replace(/\/$/, "");
  const tenant = process.env["AZURE_TENANT_ID"]?.trim() || "";
  const clientId = process.env["AZURE_CLIENT_ID"]?.trim() || "";
  const clientSecret = process.env["AZURE_CLIENT_SECRET"]?.trim() || "";
  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials", scope: "https://vault.azure.net/.default" }),
    signal: AbortSignal.timeout(15_000),
  });
  assert.ok(tokenRes.ok, `Azure AAD token HTTP ${tokenRes.status}`);
  const token = ((await tokenRes.json()) as { access_token?: string }).access_token ?? "";
  const res = await fetch(`${keyUrl}/encrypt?api-version=7.4`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ alg: "RSA-OAEP-256", value: plaintext.toString("base64url") }),
    signal: AbortSignal.timeout(15_000),
  });
  assert.ok(res.ok, `Azure Key Vault encrypt HTTP ${res.status}`);
  const json = (await res.json()) as { value?: string };
  assert.ok(json.value, "Azure Key Vault encrypt returned no value");
  // Key Vault returns base64url; azureUnwrap expects standard base64 and re-encodes to base64url.
  return Buffer.from(json.value, "base64url").toString("base64");
}

test("KMS: a data key survives a live wrap → unwrap round-trip", async (t) => {
  if (!process.env["KMS_PROVIDER"]) {
    t.skip("set KMS_PROVIDER (aws|azure|local) + provider auth to run against a live/emulated KMS");
    return;
  }
  const provider = kmsProvider();
  const key = DATA_KEY();

  let wrapped: string;
  switch (provider) {
    case "aws": {
      const keyId = process.env["LIVE_KMS_KEY_ID"]?.trim();
      if (!keyId) { t.skip("set LIVE_KMS_KEY_ID (the KMS key to Encrypt under) to run the AWS KMS round-trip"); return; }
      wrapped = await awsKmsEncrypt(keyId, key);
      break;
    }
    case "azure": {
      if (!process.env["VAULT_KMS_KEY_URL"]?.trim()) { t.skip("set VAULT_KMS_KEY_URL (+ AZURE_* creds) to run the Azure Key Vault round-trip"); return; }
      wrapped = await azureKvEncrypt(key);
      break;
    }
    case "local":
      wrapped = key.toString("base64"); // dev passthrough — proves the envelope path, not a network call
      break;
    default:
      t.skip(`KMS_PROVIDER=${process.env["KMS_PROVIDER"]} is not a live provider (use aws|azure|local)`);
      return;
  }

  const unwrapped = await unwrapDataKey(wrapped);
  assert.deepEqual(unwrapped, key, "unwrapped data key must match the original");
});

// ── AWS Secrets Manager: store → fetch → delete round-trip ────────────────────────────────────

test("Vault(AWS): a secret survives store → fetch → delete against live Secrets Manager", async (t) => {
  if (!process.env["VAULT_AWS_SECRET_ID"]) {
    t.skip("set VAULT_AWS_SECRET_ID (+ AWS creds/region) to run against a live/emulated AWS Secrets Manager");
    return;
  }
  const store = awsSecretsStore();
  const ref = testRef("aws");
  const value = `sk-live-${crypto.randomUUID()}`;

  await store.put(ref, value);
  const loaded = await store.load();
  assert.equal(loaded[ref], value, "stored secret must read back with the same value");

  await store.del(ref);
  const after = await store.load();
  assert.ok(!(ref in after), "deleted secret must be gone");
});

// ── Azure Key Vault: store → fetch → delete round-trip ────────────────────────────────────────

test("Vault(Azure): a secret survives store → fetch → delete against live Key Vault", async (t) => {
  if (!process.env["VAULT_AZURE_VAULT_URL"]) {
    t.skip("set VAULT_AZURE_VAULT_URL (+ AZURE_* creds) to run against a live/emulated Azure Key Vault");
    return;
  }
  const store = azureKeyVaultStore();
  const ref = testRef("azure");
  const value = `sk-live-${crypto.randomUUID()}`;

  await store.put(ref, value);
  const loaded = await store.load();
  assert.equal(loaded[ref], value, "stored secret must read back with the same value");

  await store.del(ref);
  const after = await store.load();
  assert.ok(!(ref in after), "deleted secret must be gone");
});

// ── OTLP: export a metric batch to a live collector ──────────────────────────────────────────

/** Parse OTEL_EXPORTER_OTLP_HEADERS ("k=v,k2=v2") into a header map (same shape kms/otlp use). */
function otlpTestHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const hdr = process.env["OTEL_EXPORTER_OTLP_HEADERS"]?.trim();
  if (hdr) for (const pair of hdr.split(",")) { const i = pair.indexOf("="); if (i > 0) headers[pair.slice(0, i).trim()] = pair.slice(i + 1).trim(); }
  return headers;
}

test("OTLP: a metric batch is accepted by a live collector", async (t) => {
  if (!process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]) {
    t.skip("set OTEL_EXPORTER_OTLP_ENDPOINT to run against a live/emulated OTLP collector");
    return;
  }
  const url = otlpMetricsEndpoint();
  assert.ok(url, "OTEL_EXPORTER_OTLP_ENDPOINT must derive a …/v1/metrics endpoint");

  const serviceName = process.env["OTEL_SERVICE_NAME"]?.trim() || "omniproject-gateway";
  const payload = toOtlpMetricsPayload(coreMetrics(), { serviceName });
  const res = await fetch(url, { method: "POST", headers: otlpTestHeaders(), body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) });

  // OTLP/HTTP collectors return 2xx (usually 200 with an empty or partial-success body) on accept.
  assert.ok(res.status >= 200 && res.status < 300, `OTLP collector should accept the batch (got HTTP ${res.status})`);

  // The real exporter path (best-effort, never throws) should also complete cleanly against live infra.
  await assert.doesNotReject(exportMetricsOnce(), "exportMetricsOnce must stay best-effort against live infra");
});
