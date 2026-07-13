# Authentication crypto & protocol provenance

The gateway's authentication does **not** hand-roll cryptography or the security-sensitive
protocol state machines. Each primitive is backed by a peer-reviewed, widely-audited library or by
Node's own OpenSSL-backed `crypto`. This document maps every piece to its backing implementation so
the provenance is auditable, and records the one deliberate exception with its rationale.

## What backs each primitive

| Concern | Backing implementation | Where |
|---|---|---|
| **OIDC flow** — discovery, PKCE, `state`/`nonce`, code→token exchange, **ID-token validation** (signature via issuer JWKS, `iss`/`aud`/`exp`, nonce binding) | **`openid-client`** (maintained OIDC RP library) | `lib/oidc.ts` |
| **Generic OAuth 2.0 flow** (non-OIDC providers, e.g. GitHub) — authorize URL, PKCE, `state`, code→token exchange | **`openid-client`** (non-OIDC `Configuration`) | `lib/oauth2.ts` |
| **JWT / JWS verification** (raw id_token verify helper) | **`jose`** (`jwtVerify`, `createLocalJWKSet`) | `lib/jwks.ts` |
| **SAML 2.0** — AuthnRequest, assertion signature/audience/conditions validation, replay protection | **`@node-saml/node-saml`** (runtime-optional) | `lib/saml.ts` |
| **Session cookie signing** (tamper-evidence) | **`cookie-parser`** signed cookies (HMAC) | `app.ts`, `routes/auth.ts` |
| **Session cookie sealing** (confidentiality) | **AES-256-GCM** via Node `crypto` (OpenSSL), HKDF-SHA256 key | `lib/session-crypto.ts` → `lib/crypto-aes-gcm.ts` |
| **Magic-link tokens** | same AES-256-GCM seal as the session | `lib/magic-link.ts` |
| **PKCE code challenge** | SHA-256 via `openid-client` / Node `crypto` | `lib/oidc.ts`, `lib/oauth2.ts` |
| **Broker PSK envelope, config-at-rest, vault** | AES-256-GCM via the same shared Node `crypto` helper | `lib/broker-psk.ts`, `lib/config-crypto.ts`, `lib/vault-store.ts` |
| **CSRF, per-IP rate limiting, step-up re-auth** | app logic over the above primitives (not crypto) | `lib/csrf.ts`, `lib/rate-limit.ts`, `routes/auth.ts` |

SSRF is preserved across all IdP hops: every `openid-client` request (discovery, JWKS, token,
userinfo) is routed through `safeFetch` via its `customFetch` seam, so the validate-then-resolve +
residency egress guards apply to the library's HTTP exactly as to our own.

## The one deliberate exception: session sealing stays on Node `crypto`

Session-cookie **confidentiality** uses AES-256-GCM directly from Node's `crypto` (OpenSSL) — not an
imported sealed-cookie library (jose JWE, `iron-session`, `@hapi/iron`). This is intentional:

- **It is not a bespoke cipher.** `lib/crypto-aes-gcm.ts` is a thin, unit-tested wrapper over Node's
  standard `createCipheriv('aes-256-gcm', …)` AEAD, with a random IV and the GCM auth tag verified on
  open. It is the codebase's **single** AES-256-GCM helper, reused by six security modules (session,
  magic-link, broker PSK, config-at-rest, vault, key-registry) — one audited primitive, not scattered
  crypto. The key is HKDF-SHA256(`SESSION_SECRET`) with domain separation and versioned prefixes
  (`v2` current, `v1` legacy) so key rotation and upgrades never force a mass logout.
- **The importable alternatives are async, and the session path is sync.** jose JWE
  (`compactDecrypt`), `iron-session`, and `@hapi/iron` are all WebCrypto-based and **asynchronous**.
  `open()` is called synchronously inside `readSession()` → `getSession()`, which is a synchronous
  function invoked from RBAC, request middleware, and 20+ route handlers. Swapping the seal to an
  async library would force that entire session-access path — and every caller — to become `async`.
- **Zero cryptographic benefit.** The result would still be AES-256-GCM. The migration would be a
  large, invasive rewrite of the most central auth module purely to change *which* correct AES-256-GCM
  implementation is called — trading real regression risk for no security gain.

Conclusion: the security-sensitive **protocol** logic (OIDC/OAuth2/SAML) is on peer-reviewed
libraries; JWT verification is on `jose`; session/at-rest **encryption** is standard AES-256-GCM from
Node's OpenSSL. Replacing the last item with an async library is a net negative, so it is kept and
documented here rather than changed.
