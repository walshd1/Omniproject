# Security audit — November 2026

Adversarial ("state-level attacker" threat model), defensive review of the OmniProject
gateway, broker seam, input handling, crypto-at-rest, and deployment/supply-chain surface.
Conducted read-only across four parallel review passes; **every finding below was then
re-verified against the source before any fix was written** (an agent handed a hypothesis
tends to confirm it, so nothing here is trusted on an agent's say-so alone — the status
column records how each was confirmed).

## Headline

The codebase is unusually well-hardened. Three of the four surfaces (input handling,
crypto-at-rest, deploy/supply-chain) yielded **no high-severity exploitable bug** — the
AEAD/KDF chain, prototype-pollution defenses, SSRF `safeFetch` pinning, audit hash-chain,
license (Ed25519, public-key-only in the image), and CI posture (`pull_request` only,
SHA-pinned actions in `ci.yml`, fail-closed advisory audit, `minimumReleaseAge`) all held.
The real issues cluster in the **auth fallback** and the **egress IP-range parser**.

Five fixes are landed in this change with regression tests; the remainder are documented
with recommended patches (one, H1, needs a design decision — see below).

---

## Fixed in this change (with regression tests)

### C1 — Demo-session fallback is an unauthenticated auth bypass on non-OIDC deployments · **Critical** · FIXED
- **Where:** `artifacts/api-server/src/routes/auth.ts` — `GET /auth/login`, the `if (!provider)` branch.
- **Verified:** reproduced via the HTTP harness (`__tests__/auth-demo-fallback.test.ts`). With native
  local users configured (a real, non-OIDC login method ⇒ `isDemoAuth()` is false) and OIDC unset, an
  anonymous `GET /api/auth/login` returned `302` + a sealed `omni_session` cookie. (The repro initially
  false-passed because `fetch` auto-follows the 302 and the mint rides the intermediate `Set-Cookie`;
  `redirect:"manual"` exposed it.)
- **Attack:** the branch keyed only on `!getOidcProvider()`, never on the demo posture. On any
  deployment whose real auth is SAML / OAuth2 / magic-link / native local users, OIDC is absent but the
  deployment is **not** demo — so an unauthenticated caller received a valid session resolving to
  `defaultBaseRole()` = **contributor** (create/update/delete issues, import, contributor-level broker
  commands). Remote, pre-auth, one GET.
- **Fix:** gate the demo mint on the runtime `isDemoAuth()` (the same predicate the file's other
  demo-only branches already use); otherwise `404`. Demo deployments are unaffected.

### SSRF-1 — IPv4-mapped / NAT64 IPv6 bypasses the metadata floor on the DNS path · **High** · FIXED
- **Where:** `artifacts/api-server/src/lib/ip-ranges.ts` — `expandIPv6`, `isLinkLocalIPv6`, `isPrivateOrLoopbackIPv6`.
- **Verified:** empirically — current code returned `isLinkLocalIPv6("::ffff:169.254.169.254") === false`
  and `isBlockedIp("::ffff:169.254.169.254", 6) === false`.
- **Attack:** the `::`-split parsed a trailing dotted-quad (`169.254.169.254`, the form `inet_ntop`/
  `dns.lookup` render for a v4-mapped AAAA) as a single `parseInt(…,16)` slot, shifting `0xffff` off
  hextet 5 so the mapped-address check missed it. An attacker-controlled domain publishing
  `AAAA ::ffff:169.254.169.254` passes the resolve-time guard, gets pinned, and on dual-stack Linux the
  socket reaches IPv4 `169.254.169.254` — the cloud metadata endpoint (the exact pattern the module
  promises to stop). The literal path was safe (WHATWG normalises `[…]` to hex). NAT64
  (`64:ff9b::/96`) and the `::` unspecified address were also uncovered.
- **Fix:** expand a trailing dotted-quad into its two hextets before the range checks; add NAT64
  well-known-prefix extraction and `::`. Tests pin the dotted, hex, NAT64 and unspecified forms.

### RESTORE-1 — `POST /setup/restore` bypasses the dual-control sign-off for security settings · **High** · FIXED
- **Where:** `artifacts/api-server/src/routes/setup/config-io.ts` (`/setup/restore`, admin-only, no
  step-up/sign-off) → `artifacts/api-server/src/lib/config-snapshot.ts` (`applySnapshot`).
- **Verified:** by code path + unit test. `PATCH /settings` routes every `SECURITY_SETTINGS` key
  (incl. `brokerUrl`, `oidcIssuerUrl`, `requireTls`) through a passkey sign-off (`settings-guard`);
  `brokerUrl` is in `SECURITY_SETTINGS` but **not** in the snapshot `EXCLUDED_KEYS`, so plaintext
  restore wrote it with admin cookie alone.
- **Attack:** a compromised admin cookie `POST`s `{settings:{brokerUrl:"https://attacker/hook"}}` and
  redirects every user's IdP bearer token (and subsequently-delegated vendor credentials) to the
  attacker — the precise invariant the dual-control gate exists to protect, reached by a side door.
- **Fix:** the plaintext restore path now skips `SECURITY_SETTINGS` keys (with a warning pointing to
  Settings); the sealed, AES-GCM-authenticated full-restore path still applies them.

### F1 — Broker reply parsed with raw `JSON.parse` at the zero-trust boundary · **Low (defense-in-depth)** · FIXED
- **Where:** `artifacts/api-server/src/broker/reference-broker/index.ts` — response parse.
- **Fix:** use the prototype-safe `safeParseJson` (the standard the other broker boundaries already
  use) so a `__proto__`/`constructor` key in an untrusted broker reply can't pollute a downstream merge.
  No concrete in-process pollution sink was demonstrated; this closes the inconsistency.

### SECRET-1 — Known committed placeholder secrets pass the production session-secret guard · **Low** · FIXED
- **Where:** `artifacts/api-server/src/lib/session-secret-guard.ts` — `evaluateSessionSecret`.
- **Attack:** the guard flagged a weak secret only when empty or exactly the one `DEV_SESSION_SECRET`
  constant. The repo's other committed defaults (`dev-only-insecure-session-secret-change-me` in
  `docker-compose.dev.yml`, `loadtest-not-a-secret-change-me`) are different public strings, so a
  deployment reusing one would boot in production on a git-history-known secret — which also roots the
  at-rest vault key.
- **Fix:** reject any secret carrying a placeholder marker (`insecure`, `change-me`, `not-a-secret`,
  `dev-only`, `loadtest`, …), not just the single constant.

---

## Recommended (verified; patch proposed, not yet applied)

### H1 — Passkey / TOTP enrolment is ungated and ceremony-free · **High** · NEEDS DECISION
- **Where:** `artifacts/api-server/src/routes/approvals.ts` (`POST /approvals/passkey`, `requireAuth`
  only) → `artifacts/api-server/src/lib/passkey.ts` `registerCredential` (stores an attacker-supplied
  SPKI with **no** WebAuthn create ceremony / attestation / challenge). Same shape for TOTP enrol.
- **Attack:** a hijacked session whose IdP claims map to admin/PMO but which was withheld the authority
  for lack of strong auth (`hasStrongAuth`) can enrol a locally-generated key, then pass
  `/auth/passkey/step-up` by signing the server challenge with it (authoring its own `clientDataJSON`)
  — self-minting `amr:["hwk"]` + a fresh `stepUpAt`. This defeats the hardware-MFA gate on pmo/admin
  **and** every `requireStepUp` action (key revocation, role-map edits, egress/governance, the raw
  escape hatch). Confirmed at the route/code level; the step-up ceremony is self-consistent against the
  attacker-enrolled key.
- **Why not auto-fixed:** the correct fix (verify the full WebAuthn registration ceremony — challenge +
  origin + rpIdHash + attestation — at enrolment, and/or require a fresh re-auth before enrol) has
  **bootstrap-flow implications** (first-passkey enrolment is intentionally how a local admin gains
  strong auth), and landing a wrong ceremony check could lock admins out. **Decision needed:** (a) full
  attestation verification, or (b) require a fresh password/IdP re-auth immediately before enrolment
  (closes the hijack path without attestation), or (c) both. I'll implement whichever you pick.

### EGRESS-2 — `guardedLookup` TOCTOU on the hardened broker keep-alive path · **Medium** · patch proposed
- **Where:** `artifacts/api-server/src/lib/egress.ts` `guardedLookup` (wired in `broker-transport.ts`).
- It enforces only the link-local/metadata floor at connect time, not `EGRESS_BLOCK_PRIVATE`/allowlist/
  residency (those run once, pre-flight, against the resolved address — but the pooled Agent re-resolves
  at connect). A rebinding DNS broker host (public at check, RFC1918 at connect) reaches internal
  services on the `brokerFetch` path even with `EGRESS_BLOCK_PRIVATE` on. **Patch:** pass the
  private-range predicate into `guardedLookup` when the flag is set.

### WEBHOOK-1 — Generated n8n workflows have no webhook authentication · **High (architectural)** · patch proposed
- **Where:** `lib/backend-catalogue/src/workflow-generator.ts` + `artifacts/n8n-blueprints/omniproject-core-sync.json`.
- The gateway signs every broker request (`X-Omni-Sig`), but no generated/shipped workflow verifies it.
  Anyone who learns the webhook URL (it leaks via `/setup/verify-workflow` responses, devtools, compose
  files, the n8n UI) gets authenticated read/write to the backend with n8n's stored credential and an
  arbitrary payload — no OmniProject session, role, scope, ruleset, or payload-guard applies; raw body
  fields interpolate into backend request URLs (path/query shaping). **Patch:** generate the Webhook
  node with n8n header-auth (or an HMAC-verify code node checking `X-Omni-Sig`), and document the
  webhook URL as a bearer-equivalent secret. The gateway signing half already exists.

### M2 — Logout does not revoke the session server-side · **Medium** · patch proposed
- **Where:** `artifacts/api-server/src/routes/auth.ts` `POST /auth/logout` clears cookies only.
  A captured cookie copy stays valid until idle (15 min) / absolute (4 h) expiry. **Patch:** call
  `revokeSession(sub, sessionPublicId(session))` on logout (the machinery `/auth/sessions/revoke` uses).

### Lower-severity (verified, patch in report)
- **F2** `data-residency.ts` region match uses unanchored `startsWith` → match on parsed origin (operator-config only, Low).
- **F3** `logger.ts` redaction misses two-level `req.body.password` (pino wildcards span one level); latent — add deep paths before logging any nested body (Low).
- **SAML-1/2** SAML/OAuth2 step-up stamps freshness without proving re-auth; `validateInResponseTo:"ifPresent"` allows unsolicited-assertion replay without Redis → validate `AuthnInstant`; recommend `SAML_STRICT_REPLAY=1` (Low-Med, identity binding still holds).

---

## Deployment / CI hardening (deploy agent; verified by file read)

- **CI-1 (Medium)** `release.yml` uses mutable tags for third-party actions (`docker/login-action@v4`,
  `softprops/action-gh-release@v3`) while `ci.yml` SHA-pins everything — the release job holds the GHCR
  push + Sigstore signing identity, so pin these to 40-char SHAs.
- **CI-2 (Medium)** `ci.yml` downloads trivy/gitleaks/kubeconform with empty `*_SHA256` (same-origin
  checksum only). Fill the digest pins.
- **CI-3 (Low)** `github.head_ref`/`github.ref_name` interpolated into `run:` blocks (script-injection
  class; `pull_request` + read-only token bound the blast radius) — move into `env:` and quote.
- **TRUST_PROXY (Medium, operational)** none of the shipped compose/k8s artifacts set `TRUST_PROXY`, so
  behind the documented Traefik topology `req.ip` is the proxy IP and the per-IP login/step-up limiter
  collapses to one global bucket (cheap deployment-wide login DoS; impossible-travel inert). Set
  `TRUST_PROXY=1` in the Traefik compose/k8s and document the direct-exposure caveat.

---

## What was attacked and held (not exhaustive)

OIDC core (full ID-token validation, PKCE S256, CSPRNG state/nonce, SSRF-guarded discovery);
`resolveBaseUrl` host-header injection (hard-fails without `PUBLIC_URL` in production-like env);
open-redirect (`safeLocalPath`); session cookie crypto (AES-256-GCM + HKDF, fail-safe default-secret
refusal, seq fork-detection, per-login CSRF rotation); local passwords (scrypt + constant-time + dummy
work); magic-link (sealed, 15-min TTL, atomic single-use `jti`, no enumeration, header-injection-safe);
TOTP (step replay-lock, hashed recovery codes); the central `requireAuth` + viewer-floor gate (no
mutating route escapes it); break-glass (≥24-char token, constant-time, containment-only);
`safeFetch` redirect re-validation + credential-header stripping + IP pinning; AEAD IV uniqueness +
tag enforcement; audit HMAC hash-chain; Ed25519 license (public-key-only); Dockerfiles (digest-pinned,
non-root, no secrets in layers); k8s manifest (`runAsNonRoot`, `readOnlyRootFilesystem`, cap-drop,
default-deny + anti-metadata NetworkPolicy, no token automount); supply chain (`minimumReleaseAge`,
install-scripts disabled, fail-closed audit).

---

*Method: four parallel read-only reviewers (identity/session; broker/egress; input/crypto;
deploy/supply-chain), each finding independently re-verified against source before any fix. Fixes
follow a failing-test-then-patch discipline; no exploit tooling was produced.*
