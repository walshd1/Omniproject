import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Deserialization-boundary gate — this repo has no ESLint, so the "ban bare JSON.parse on untrusted
 * input" rule is enforced here, as a test (the same idiom as contract-coverage.test.ts).
 *
 * The rule: outside lib/safe-json.ts, any `JSON.parse(` in server source must be TRUSTED input — a
 * value whose integrity is already established (a sealed/encrypted local config file, a signature-
 * verified blob, a secret-manager response, a CLI arg, or the built-in store's own at-rest data).
 * UNTRUSTED input — an HTTP body, a cross-replica bus/shared-KV message, an external-peer response,
 * a JWT before verification, an LLM reply — must go through safeParseJson (which strips
 * __proto__/constructor/prototype at every depth).
 *
 * ALLOWLIST records every file that still uses bare JSON.parse, the reason it's trusted, AND the
 * expected occurrence COUNT. A NEW file using JSON.parse fails until classified; ADDING a JSON.parse
 * to an already-listed file bumps the count and also fails until the new use is justified and the
 * count updated. So a new untrusted parse can't slip in unreviewed.
 */

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** file (relative to src/) → { count, reason } for every TRUSTED bare-JSON.parse site. */
const ALLOWLIST: Record<string, { count: number; reason: string }> = {
  // Sealed/encrypted local config files (decrypted via SealedFile before parse — integrity established).
  "lib/settings.ts": { count: 2, reason: "sealed settings store load (SealedFile-decrypted) + trusted env-seed parsers" },
  "lib/labels.ts": { count: 1, reason: "deploy-controlled LABEL_OVERRIDES env var (admin-set at deploy, not request input)" },
  "lib/config-store.ts": { count: 1, reason: "sealed config-store load (cross-replica ring uses safeParseJson)" },
  "lib/ai-providers.ts": { count: 1, reason: "sealed providers-state load" },
  "lib/rate-card-store.ts": { count: 1, reason: "sealed rate-card store load" },
  "lib/security-state.ts": { count: 1, reason: "sealed security-state load" },
  "lib/scim.ts": { count: 1, reason: "sealed SCIM directory load (cross-replica uses safeParseJson in scim.ts)" },
  "lib/ruleset.ts": { count: 2, reason: "sealed ruleset store load" },
  "lib/residency-policy.ts": { count: 1, reason: "sealed residency-policy load, then validateResidencyPolicy" },
  "lib/audit-chain.ts": { count: 1, reason: "sealed chain-head load (the cross-replica shared head uses safeParseJson)" },
  "lib/archive/archive-store.ts": { count: 1, reason: "archive store's own at-rest text" },
  "lib/magic-link.ts": { count: 1, reason: "decrypted (opened) magic-link payload" },
  "lib/saml.ts": { count: 1, reason: "own stored SAML config value" },
  // Signature / integrity-verified blobs.
  "lib/license.ts": { count: 1, reason: "license payload AFTER Ed25519 signature verification" },
  "routes/auth.ts": { count: 4, reason: "session + OAuth/OIDC flow cookies — cookie-parser HMAC-verifies (signedCookies) / open()-decrypts before parse" },
  // Secret-manager responses (trusted infra behind authenticated clients).
  "lib/vault-aws.ts": { count: 1, reason: "AWS Secrets Manager response (authenticated infra)" },
  "lib/vault-azure.ts": { count: 1, reason: "Azure Key Vault response (authenticated infra)" },
  "lib/vault-store.ts": { count: 1, reason: "sealed vault-store load" },
  "lib/user-credentials.ts": { count: 1, reason: "separately-keyed credential store load (AES-256-GCM aesGcmOpen-authenticated before parse — integrity established)" },
  // The built-in store / broker's OWN at-rest data (not a cross-trust boundary).
  "broker/builtin/sidecar-store.ts": { count: 1, reason: "built-in broker's own SQLite sidecar rows" },
  "broker/reference-broker/index.ts": { count: 3, reason: "reference broker's own sealed/opened storage" },
  "history/connectors/object-store.ts": { count: 2, reason: "history connector reading its OWN-written entries from the configured object store" },
  "history/connectors/warehouse.ts": { count: 2, reason: "history connector reading its OWN-written rows from the configured warehouse" },
  // Dev-only / CLI tools (local files + operator-supplied args; never on a request path).
  "lib/dev-persist.ts": { count: 1, reason: "dev-only local demo-state file" },
  "broker/dev-broker.ts": { count: 1, reason: "dev broker local demo-state file" },
  "broker/capture.ts": { count: 1, reason: "dev/test broker exchange-capture local file" },
  "broker/replay-cli.ts": { count: 1, reason: "CLI: operator-supplied replay args" },
  "broker/send-cli.ts": { count: 1, reason: "CLI: operator-supplied command payload" },
};

/** Recursively list every non-test .ts under src/, excluding safe-json.ts itself. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...sourceFiles(full)); continue; }
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    if (full === path.join(SRC, "lib", "safe-json.ts")) continue;
    out.push(full);
  }
  return out;
}

/** Count `JSON.parse(` occurrences in a file (comments count too — keep them out of scanned source). */
function countJsonParse(file: string): number {
  return (fs.readFileSync(file, "utf8").match(/JSON\.parse\(/g) ?? []).length;
}

test("no unallowlisted bare JSON.parse: untrusted deserialization must use safeParseJson", () => {
  const offenders: string[] = [];
  const seen = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file);
    const n = countJsonParse(file);
    if (n === 0) continue;
    seen.add(rel);
    const allow = ALLOWLIST[rel];
    if (!allow) {
      offenders.push(`${rel}: ${n} bare JSON.parse — classify in ALLOWLIST (trusted) or switch to safeParseJson (untrusted)`);
    } else if (n !== allow.count) {
      offenders.push(`${rel}: JSON.parse count changed ${allow.count} → ${n} — re-verify each is trusted, then update the count`);
    }
  }
  assert.deepEqual(offenders, [], `Deserialization-boundary gate failed:\n${offenders.join("\n")}`);

  // Keep the allowlist honest: a listed file that no longer uses JSON.parse must be removed.
  const stale = Object.keys(ALLOWLIST).filter((rel) => !seen.has(rel)).sort();
  assert.deepEqual(stale, [], `Stale ALLOWLIST entries (no bare JSON.parse anymore — remove):\n${stale.join("\n")}`);
});
