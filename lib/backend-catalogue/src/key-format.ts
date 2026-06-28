/**
 * KEY-FORMAT resolution — what key does a target require to be reached?
 *
 * The point of declaring a key format is so a keyless request can be HARD-REJECTED
 * before it ever leaves the gateway (the dev-mode-exempt posture in
 * broker/key-guard.ts), and so the wizard can scaffold the right credential. The
 * value of the key is NEVER stored by OmniProject — a KeyFormat only describes
 * WHERE the operator's key lives (env var / header) and WHAT it must look like.
 *
 * Two sources, in priority order:
 *   1. An explicit `keyFormat` block in the vendor/broker JSON (the override).
 *   2. For backends, DERIVED from the binding that is already in the JSON
 *      (`authHeader` / `credentialType` / `requiredEnv` / `kind`) — so the key
 *      format is single-sourced and cannot drift from the auth wiring it describes.
 *      For brokers, the default is the gateway→broker pre-shared key (BROKER_PSK).
 */

import type { KeyFormat } from "./backend-manifest";
import type { BackendDefinition } from "./backend-catalogue";
import type { BrokerDefinition } from "./broker-catalogue";

/** An n8n `$env.NAME` reference inside an auth expression. */
const AUTH_ENV = /\{\{\s*\$env\.([A-Z0-9_]+)\s*\}\}/;
/** The per-user impersonation marker (the caller's own forwarded bearer). */
const PER_USER = /userContext\.token/;

/** The broker hop's default key: the gateway↔broker pre-shared key. Brokers that
 *  don't override it are reached over the BROKER_PSK-sealed/HMAC-signed wire. */
export const BROKER_DEFAULT_KEY_FORMAT: KeyFormat = {
  scheme: "psk",
  env: ["BROKER_PSK"],
  header: "X-Omni-Sig",
  pattern: "^.{16,}$",
};

/**
 * Derive a backend's key format from its binding fields (the single source of
 * truth already in the JSON). Order matters — most specific first.
 */
export function deriveBackendKeyFormat(
  def: Pick<BackendDefinition, "authHeader" | "credentialType" | "requiredEnv" | "kind">,
): KeyFormat {
  // One-shot import sources (spreadsheet upload) carry no live credential.
  if (def.kind === "import") return { scheme: "none" };

  const ah = def.authHeader ?? "";
  // Per-user impersonation: the caller's own bearer, no operator-side env var.
  if (PER_USER.test(ah)) return { scheme: "per-user", header: "Authorization" };

  // Operator env-backed Authorization header (Basic/Bearer from $env.X).
  const m = ah.match(AUTH_ENV);
  const env = m ? { env: [m[1]!] } : {};
  if (/^=?Basic\b/.test(ah)) return { scheme: "basic", header: "Authorization", ...env };
  if (/^=?Bearer\b/.test(ah)) return { scheme: "bearer", header: "Authorization", ...env };

  // Broker-managed credential (native n8n node): the secret lives in the broker's
  // own credential store, not an OmniProject env var. Infer the scheme from the
  // credential type's name (…OAuth2Api / …BasicApi / …Api).
  if (def.credentialType) {
    const ct = def.credentialType;
    const scheme: KeyFormat["scheme"] = /oauth/i.test(ct) ? "oauth2" : /basic/i.test(ct) ? "basic" : "apiKey";
    return { scheme, header: "Authorization" };
  }

  return { scheme: "none" };
}

/** The key a backend requires — explicit JSON override, else derived from the binding. */
export function backendKeyFormat(def: BackendDefinition): KeyFormat {
  return def.keyFormat ?? deriveBackendKeyFormat(def);
}

/** The key a broker requires — explicit JSON override, else the BROKER_PSK default. */
export function brokerKeyFormat(def: Pick<BrokerDefinition, "keyFormat">): KeyFormat {
  return def.keyFormat ?? BROKER_DEFAULT_KEY_FORMAT;
}

/** True when reaching this target genuinely needs no key (import sources, demo). */
export function isKeyless(kf: KeyFormat): boolean {
  return kf.scheme === "none";
}
