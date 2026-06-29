import { jwtVerify, createLocalJWKSet, type JSONWebKeySet } from "jose";
import { assertSafeOutboundUrl } from "./url-safety";

/**
 * JWKS / ID-token verification.
 *
 * The cryptographic verification (signature + standard claims) is delegated to
 * `jose` — a well-reviewed, widely-audited JOSE implementation — rather than
 * hand-rolled against Node's primitives. We keep the parts that are policy, not
 * crypto, in our own hands:
 *   - the **algorithm allowlist** (asymmetric only: RS/PS/ES) so `alg:none` and
 *     HMAC `alg`-confusion attacks are rejected before any key is consulted;
 *   - the **SSRF guard** on the issuer-supplied `jwks_uri` — we fetch the keys
 *     ourselves through `assertSafeOutboundUrl` and hand jose a *local* key set,
 *     so jose never performs an unguarded outbound request.
 */

export interface Jwk {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

export interface JwtClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  sub?: string;
  [k: string]: unknown;
}

/** Asymmetric algorithms only. Excluding HS* and `none` blocks alg-confusion
 *  (signing with the public key as an HMAC secret) and unsigned tokens. */
export const ALLOWED_ALGS = [
  "RS256", "RS384", "RS512",
  "PS256", "PS384", "PS512",
  "ES256", "ES384", "ES512",
];

const LEEWAY_SEC = 60;

/** Decode a compact JWS into its header + claims without verifying. For
 *  diagnostics/routing only — never trust these values before `verifyIdToken`. */
export function parseJwt(token: string): { header: { alg: string; kid?: string; typ?: string }; claims: JwtClaims } {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT (expected 3 segments)");
  const [seg0, seg1] = parts as [string, string, string];
  const header = JSON.parse(Buffer.from(seg0, "base64url").toString("utf8"));
  const claims = JSON.parse(Buffer.from(seg1, "base64url").toString("utf8"));
  if (!header.alg || typeof header.alg !== "string") throw new Error("JWT header missing alg");
  return { header, claims };
}

/** Validate the standard claims (pure comparison, no crypto). Returns null on
 *  success, else the reason. `verifyIdToken` enforces these via jose; this is a
 *  standalone helper for callers that already hold verified claims. */
export function validateClaims(
  claims: JwtClaims,
  opts: { issuer: string; audience: string; now?: number; leewaySec?: number },
): string | null {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const leeway = opts.leewaySec ?? LEEWAY_SEC;

  if (claims.iss !== opts.issuer) return `issuer mismatch (got ${claims.iss})`;

  const aud = claims.aud;
  const audOk = Array.isArray(aud) ? aud.includes(opts.audience) : aud === opts.audience;
  if (!audOk) return "audience mismatch";

  if (typeof claims.exp === "number" && now > claims.exp + leeway) return "token expired";
  if (typeof claims.nbf === "number" && now + leeway < claims.nbf) return "token not yet valid";

  return null;
}

// ── JWKS fetch + cache (SSRF-guarded) ───────────────────────────────────────────

const jwksCache = new Map<string, { keys: Jwk[]; at: number }>();
const JWKS_TTL_MS = 10 * 60 * 1000;

/** Fetch the issuer's JWKS signing keys, cached for 10 minutes. The `jwks_uri`
 *  comes from the issuer's discovery doc (IdP-controlled), so it is guarded
 *  against a metadata/link-local SSRF pivot before every fetch. */
export async function fetchJwks(jwksUri: string, fetchImpl: typeof fetch = fetch): Promise<Jwk[]> {
  const cached = jwksCache.get(jwksUri);
  if (cached && Date.now() - cached.at < JWKS_TTL_MS) return cached.keys;
  assertSafeOutboundUrl(jwksUri, "jwks_uri");
  const res = await fetchImpl(jwksUri, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`);
  const doc = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(doc.keys) ? doc.keys : [];
  jwksCache.set(jwksUri, { keys, at: Date.now() });
  return keys;
}

/**
 * Full verification: fetch the JWKS (SSRF-guarded), then have jose verify the
 * signature against the matching key and validate iss/aud/exp/nbf under the
 * asymmetric-only algorithm allowlist. Returns the verified claims or throws.
 */
export async function verifyIdToken(
  idToken: string,
  opts: { jwksUri: string; issuer: string; audience: string; fetchImpl?: typeof fetch },
): Promise<JwtClaims> {
  const keys = await fetchJwks(opts.jwksUri, opts.fetchImpl);
  if (keys.length === 0) throw new Error("No JWKS keys");

  // jose verifies against a LOCAL set — we already did the guarded fetch, so jose
  // performs no outbound request of its own.
  const jwks = createLocalJWKSet({ keys } as unknown as JSONWebKeySet);

  try {
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: opts.issuer,
      audience: opts.audience,
      algorithms: ALLOWED_ALGS,
      clockTolerance: LEEWAY_SEC,
    });
    return payload as JwtClaims;
  } catch (err) {
    // Normalise jose's typed errors to the messages our callers/tests expect.
    const msg = err instanceof Error ? err.message : String(err);
    if (/signature/i.test(msg)) throw new Error("JWT signature verification failed");
    throw new Error(`JWT verification failed: ${msg}`);
  }
}
