# OmniProject — security audit

A consolidated audit of OmniProject's security posture: the controls, where each is implemented,
how it's configured, and an honest statement of scope and residual risk. It complements the
deeper-dive companions:

- [`AI-SECURITY.md`](./AI-SECURITY.md) — the end-to-end AI control model (keys, governance, kill-switch).
- [`EGRESS-INVENTORY.md`](./EGRESS-INVENTORY.md) — every outbound destination the gateway can reach.
- [`COMPOSE-AUDIT.md`](./COMPOSE-AUDIT.md) — deployment-topology hardening.
- [`ROLES.md`](./ROLES.md) — the RBAC model in product terms.
- [`COMPLIANCE.md`](./COMPLIANCE.md) — control mapping to SOC 2 / ISO 27001 / NIST CSF.
- [`THREAT-MODEL.md`](./THREAT-MODEL.md) — STRIDE threat model + trust boundaries.
- [`PRIVACY.md`](./PRIVACY.md) — controller/processor position, ROPA template, sub-processors.
- [`ACCESSIBILITY-CONFORMANCE.md`](./ACCESSIBILITY-CONFORMANCE.md) — WCAG 2.1 AA ACR (VPAT-style).

## Design context (what shapes the threat model)

OmniProject is a **stateless, zero-at-rest overlay gateway**. It does **not** own a user directory,
does **not** store project data, and (by default) persists nothing locally. Identity is asserted by
the customer's IdP over OIDC; the **systems of record still enforce their own authorization** on
every brokered write (the user's own bearer token is forwarded downstream). The gateway's controls
are therefore **defence-in-depth and UX**, layered on top of — not a replacement for — backend authz.

## Control summary

| Domain | Control | Module(s) | Default |
| --- | --- | --- | --- |
| Authentication | OIDC + OAuth2/PKCE + SAML + magic-link; read-only API tokens | `routes/auth`, `lib/api-token` | OIDC |
| Session security | Sealed cookie; sliding idle + absolute cap; server-side expiry | `lib/session-*`, `lib/session-timeout` | idle 30m / abs 8h |
| Step-up re-auth | Fresh re-auth required for high-risk actions | `lib/step-up` | enforced |
| CSRF | Origin/Referer check + double-submit token on cookie mutations | `lib/csrf` | on |
| Authorization | Linear role ladder + two orthogonal authorities; SCIM lifecycle | `lib/rbac`, `lib/scim` | least-privilege |
| Transport | TLS at the edge; `Secure`/`HttpOnly`/`SameSite=Lax` cookie | proxy + `lib/session-*` | prod-enforced |
| Secrets at rest | Pluggable vault (local AES-GCM or external KMS) | `lib/vault-store`, `lib/vault-*` | local encrypted |
| Config at rest | AES-256-GCM sealed config; rekey-on-export | `lib/config-crypto` | on when persisted |
| Broker seam | Per-session HMAC + timestamp + single-use nonce (replay defence) | `lib/broker-hmac`, `lib/session-key` | on |
| Audit | Tamper-evident keyed hash chain; optional Ed25519 non-repudiation | `lib/audit-chain`, `lib/signing` | chain on |
| Egress / SSRF | Metadata/link-local always blocked; optional strict allowlist | `lib/egress` | metadata-blocked |
| Rate limiting | Per-user/IP limiter; Redis-shared under scale | `lib/rate-limit` | 300 / 15m |
| Injection | Validation, parameterisation, output encoding | (cross-cutting) | enforced |
| AI safety | Governance tri-state, prompt DLP, kill-switch | see `AI-SECURITY.md` | no-AI-by-default |

## Findings by domain

### 1. Authentication & sessions
- **Multi-protocol SSO** — OIDC (ID-token verified with `jose`), generic OAuth 2.0 + PKCE, SAML 2.0,
  and passwordless magic-link / email-OTP for orgs without an IdP. Read-only **API tokens**
  (`API_TOKENS`) authenticate non-interactive BI/export clients and are restricted to `GET`.
- **Sessions are sealed cookies**, not server state (stateless). A **sliding idle timeout**
  (`SESSION_IDLE_MINUTES`, default 30) plus an **absolute cap** from `iat` (`SESSION_ABSOLUTE_HOURS`,
  default 8) are enforced **server-side**: an expired session reads as "no session" everywhere, so a
  stolen long-lived cookie can neither idle indefinitely nor outlive the absolute cap.
- **Step-up re-auth** (`lib/step-up`): revoking a key, flipping an egress/governance setting, or
  running the raw escape hatch requires a *recent* re-authentication (`stepUpAt`, OIDC `prompt=login`),
  shrinking the blast radius of a hijacked-but-idle session.

### 2. Authorization
- **RBAC** (`lib/rbac`) derives grants from OIDC role/group claims: a linear `viewer → contributor →
  manager` ladder plus two **orthogonal authorities** (admin, PMO) — capability sets, not ranks. The
  gateway gate is **defence-in-depth**; the backend system of record still authorizes every write.
- **SCIM 2.0 lifecycle** (`lib/scim`): an IdP can `active=false` a user — denied at the gate even
  with a still-valid OIDC token — and drive group→role membership. State is held in memory and
  persisted **sealed**. Enabled only when `SCIM_TOKEN` is set.
- **Feature-gating / governance boundary** (`lib/feature-resolution`, `routes/features.ts`): the
  org→programme→project resolver enforces **monotonic narrowing** — every level can only *remove*, and
  hard `require`/`forbid` mandates from an ancestor **lock** descendants (the resolver evaluates org →
  programme → project, first-rule-wins, so a lower level can never out-vote an ancestor lock). The write
  endpoints additionally enforce: a **parent-ceiling check** on `required` *and* on the manageable set
  (which now excludes ancestor `forbid` locks, not just soft disables); **catalogue-id validation**
  (unknown ids rejected, no silent dead config); **require∩forbid conflict rejection**; and a
  **reserved-key guard** (`__proto__`/`constructor`/`prototype`) on scope ids. Every mutation is
  **semantically audited** (`governance.{org,programme,project}.update` with the added/removed sets), and
  the report/methodology planes are enforced server-side — a `forbid report:x` / `forbid methodology:x`
  actually withholds the item from `/api/setup/reports` and `/api/setup/methodologies`, not just the
  admin table.
  - **Residual (by design):** `pmo`/`manager` are **global role classes** — OmniProject is a stateless
    overlay with no user→scope directory, so the gate authorizes by *role*, not by *which* programme/
    project a principal owns. A `pmo` can therefore edit any programme's policy. This is acceptable for
    the single-PMO / small-estate target and is **defence-in-depth** (the resolver still can't grant a
    capability the org withheld, and the backend system of record authorizes every brokered write); a
    per-scope ownership model would require the optional stateful directory (`PARKED-DECISIONS §0`).

### 3. Web-layer hardening
- **CSRF** (`lib/csrf`): `SameSite=Lax` baseline + (1) an **Origin/Referer** check rejecting any
  cross-site origin on unsafe `/api` methods, and (2) a **double-submit token** (`omni_csrf` cookie
  echoed in `X-CSRF-Token`) for browser-driven mutations. Machine callers (broker, ingest, MCP, API
  token) are out of scope (they don't ride the ambient cookie).
- **Injection hardening**: input validation at the route boundary, parameterised access for the
  optional SQL/Mongo backends, and output encoding — covered by the injection-hardening audit pass.

### 4. Secrets, config & crypto at rest
- **Vault seam** (`lib/vault-store`): AI provider keys live in a pluggable store — `local` (per-secret
  derived subkey **plus** a whole-file seal — two layers of AES-GCM), or external **HashiCorp Vault /
  AWS Secrets Manager / Azure Key Vault / generic HTTP**. For external stores the manager is the
  encryption boundary (TLS in transit, no double-encryption).
- **Config at rest** (`lib/config-crypto`): config files are sealed with AES-256-GCM under a
  **versioned internal key that is never exported**. Export decrypts, **re-encrypts under a one-time
  ephemeral key**, returns the bundle + that key, then **rekeys** internal use — so the material that
  leaves only ever opens that one bundle and the live store moves to fresh material.
- **Vendor API keys are never stored** except AI provider keys, which live in the vault — by policy.

### 5. The gateway↔broker seam
- **Per-session request signing** (`lib/broker-hmac` + `lib/session-key`): a detached HMAC over the
  body + timestamp + **single-use nonce** lets the broker reject **replays** and **stale** traffic.
  The signing key is **derived per user + per session** from the env master, so a verifying signature
  proves "from THIS user's valid session on our gateway", and a captured signature can't be reused
  under another identity. Doubles as the provenance MAC.

### 6. Audit & non-repudiation
- **Tamper-evident audit chain** (`lib/audit-chain`): every event is sealed into an append-only,
  keyed hash chain (`hash = HMAC(auditKey, seq | prevHash | canonical(event))`); the sealed fields
  ride into stdout/the SIEM so the external copy is self-verifying. Removing/reordering breaks every
  later link.
- **Optional Ed25519 signing** (`lib/signing`): signing the chain anchor with a gateway-only private
  key (`SIGNING_PRIVATE_KEY`) upgrades tamper-*evidence* to **non-repudiation** — anyone with the
  public key can confirm the gateway attests to that history. Off by default, side-effect-free.

### 7. Outbound (SSRF) & abuse
- **Egress guard** (`lib/egress`): cloud-metadata / link-local targets and non-http(s) schemes are
  **always blocked** (defeats the Capital-One SSRF→metadata→IAM pattern); an optional
  `EGRESS_ALLOWLIST` pins all outbound hosts to an explicit set.
- **Rate limiting** (`lib/rate-limit`): per-user (session `sub`) or per-IP; `API_RATE_LIMIT_MAX`
  (300/15m) with a tighter analytics bucket; Redis-shared under horizontal scale so the ceiling holds
  fleet-wide.

### 8. AI security
See [`AI-SECURITY.md`](./AI-SECURITY.md) for the full model: **no-AI-by-default**, tri-state
capability governance (off / user-defined / public), prompt DLP, autonomous actors as short-TTL keyed
principals, and an admin kill-switch — all of which feed the same audit chain.

## Residual risk & honest scope

- **The audit chain proves integrity to a holder of the audit key** (the deployment). Cross-party
  non-repudiation requires enabling Ed25519 signing and distributing the public key.
- **Gateway RBAC is defence-in-depth, not the sole control** — the backend system of record remains
  the authority on brokered writes.
- **Rate-limit and presence counters are per-replica** unless `REDIS_URL` is configured; multi-replica
  deployments should set it to enforce a true global ceiling.
- **The vault's `local` backend ties at-rest secrecy to the env master key**; high-assurance
  deployments should use an external KMS/Vault backend so key custody leaves the app entirely.
- **OmniProject does not scan brokered content** for malware/DLP beyond prompt DLP — that remains the
  responsibility of the systems of record and the network edge.

## Verifying the controls

Every control above ships with tests (`*.test.ts` next to each module) run in CI's `verify` job, plus
the `dependency-scan` (advisories), `accessibility` (axe-core), and `deploy-lint` (compose + k8s)
jobs. To exercise the security suite locally:

```sh
pnpm --filter @workspace/api-server test     # includes csrf / step-up / egress / broker-hmac / signing / vault / audit-chain / scim
```
