import crypto from "node:crypto";

/**
 * Dependency-free JWKS / JWT signature verification.
 *
 * The OIDC relying party previously decoded the ID token without checking its
 * signature (acceptable only because it arrived over TLS straight from the token
 * endpoint). This verifies the signature against the issuer's published JWKS and
 * validates the core claims, so a forged or tampered token is rejected.
 *
 * Uses only Node's crypto (createPublicKey supports JWK input), so no new deps.
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

interface ParsedJwt {
  header: { alg: string; kid?: string; typ?: string };
  claims: JwtClaims;
  signingInput: string;
  signature: Buffer;
}

const ALLOWED_ALGS = new Set([
  "RS256", "RS384", "RS512",
  "PS256", "PS384", "PS512",
  "ES256", "ES384", "ES512",
]);

/** Split + decode a compact JWS. Throws on malformed input. */
export function parseJwt(token: string): ParsedJwt {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT (expected 3 segments)");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  if (!header.alg || typeof header.alg !== "string") throw new Error("JWT header missing alg");
  return {
    header,
    claims,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: Buffer.from(parts[2], "base64url"),
  };
}

/** Verify a parsed JWT's signature against a single JWK. */
export function verifySignatureWithJwk(parsed: ParsedJwt, jwk: Jwk): boolean {
  const alg = parsed.header.alg;
  if (!ALLOWED_ALGS.has(alg)) throw new Error(`Unsupported JWT alg: ${alg}`);

  const keyObject = crypto.createPublicKey({ key: jwk, format: "jwk" } as crypto.JsonWebKeyInput);
  const data = Buffer.from(parsed.signingInput);
  const digest = `sha${alg.slice(2)}`; // sha256 | sha384 | sha512

  if (alg.startsWith("RS")) {
    return crypto.verify(digest, data, keyObject, parsed.signature);
  }
  if (alg.startsWith("PS")) {
    return crypto.verify(
      digest,
      data,
      { key: keyObject, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST },
      parsed.signature,
    );
  }
  // ES*: JWS uses raw r||s concatenation (IEEE P1363), not DER.
  return crypto.verify(digest, data, { key: keyObject, dsaEncoding: "ieee-p1363" }, parsed.signature);
}

/** Validate the standard claims. Returns null on success, else the reason. */
export function validateClaims(
  claims: JwtClaims,
  opts: { issuer: string; audience: string; now?: number; leewaySec?: number },
): string | null {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const leeway = opts.leewaySec ?? 60;

  if (claims.iss !== opts.issuer) return `issuer mismatch (got ${claims.iss})`;

  const aud = claims.aud;
  const audOk = Array.isArray(aud) ? aud.includes(opts.audience) : aud === opts.audience;
  if (!audOk) return "audience mismatch";

  if (typeof claims.exp === "number" && now > claims.exp + leeway) return "token expired";
  if (typeof claims.nbf === "number" && now + leeway < claims.nbf) return "token not yet valid";

  return null;
}

// ── JWKS fetch + cache ────────────────────────────────────────────────────────

const jwksCache = new Map<string, { keys: Jwk[]; at: number }>();
const JWKS_TTL_MS = 10 * 60 * 1000;

export async function fetchJwks(jwksUri: string, fetchImpl: typeof fetch = fetch): Promise<Jwk[]> {
  const cached = jwksCache.get(jwksUri);
  if (cached && Date.now() - cached.at < JWKS_TTL_MS) return cached.keys;
  const res = await fetchImpl(jwksUri, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`);
  const doc = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(doc.keys) ? doc.keys : [];
  jwksCache.set(jwksUri, { keys, at: Date.now() });
  return keys;
}

function selectKeys(keys: Jwk[], kid?: string): Jwk[] {
  if (kid) {
    const exact = keys.filter((k) => k.kid === kid);
    if (exact.length) return exact;
  }
  // No kid (or no match) → try signature-capable keys.
  return keys.filter((k) => k.use === "sig" || k.use === undefined);
}

/**
 * Full verification: fetch JWKS, verify signature against the matching key, and
 * validate iss/aud/exp/nbf. Returns the verified claims or throws.
 */
export async function verifyIdToken(
  idToken: string,
  opts: { jwksUri: string; issuer: string; audience: string; fetchImpl?: typeof fetch },
): Promise<JwtClaims> {
  const parsed = parseJwt(idToken);
  if (!ALLOWED_ALGS.has(parsed.header.alg)) throw new Error(`Unsupported JWT alg: ${parsed.header.alg}`);

  const keys = await fetchJwks(opts.jwksUri, opts.fetchImpl);
  const candidates = selectKeys(keys, parsed.header.kid);
  if (candidates.length === 0) throw new Error("No matching JWKS key");

  let verified = false;
  for (const jwk of candidates) {
    try {
      if (verifySignatureWithJwk(parsed, jwk)) { verified = true; break; }
    } catch {
      // try the next candidate key
    }
  }
  if (!verified) throw new Error("JWT signature verification failed");

  const reason = validateClaims(parsed.claims, { issuer: opts.issuer, audience: opts.audience });
  if (reason) throw new Error(`JWT claim validation failed: ${reason}`);

  return parsed.claims;
}
