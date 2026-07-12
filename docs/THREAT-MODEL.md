# Threat model

A STRIDE threat model for the OmniProject gateway and its trust boundaries. It consolidates the
defences detailed in [`SECURITY-AUDIT.md`](./SECURITY-AUDIT.md) and [`AI-SECURITY.md`](./AI-SECURITY.md)
into an attacker-centric view, for security review and pen-test scoping.

## System & trust boundaries

```
            ┌──────────── browser (untrusted client) ────────────┐
            │  SPA — sealed session cookie, CSRF token            │
            └───────────────┬─────────────────────────────────────┘
                            │  TLS (edge)         ── boundary 1: client ↔ gateway
            ┌───────────────▼─────────────── gateway (stateless) ─┐
            │  authn/z · CSRF · egress guard · rate limit · audit  │
            │  vault (keys)        per-session broker HMAC + nonce  │
            └───┬───────────────────────────┬─────────────────────┘
   boundary 2:  │ IdP (OIDC/SAML)           │  boundary 3: gateway ↔ broker (PSK + HMAC)
   gateway↔IdP  ▼                           ▼
          ┌─────────┐               ┌──────────────── broker (n8n) ──────────────┐
          │  IdP    │               │  workflows → systems of record (Jira, …)    │
          └─────────┘               │            → optional AI provider           │
                                    └─────────────────────────────────────────────┘
```

Trusted: the gateway process, the operator-supplied secrets/keys. Untrusted: the browser, the
network, and (per zero-trust) the broker plane and backends across boundary 3.

## STRIDE

### Spoofing
- **Threats:** stolen/forged session cookie; replayed gateway→broker request under another identity;
  CSRF riding the ambient cookie; account enumeration via magic-link.
- **Defences:** sealed (HMAC) cookie + `SameSite=Lax`; **idle + absolute** session caps and **step-up**
  re-auth shrink a stolen cookie's value; gateway→broker requests are signed with a **per-session**
  key (proves "this user's valid session"), with a single-use **nonce** + timestamp rejecting replays;
  CSRF Origin/Referer + double-submit token; magic-link **always answers `ok`** (no enumeration).

### Tampering
- **Threats:** altering audit records; man-in-the-middle on the seam; modifying config at rest;
  forging a broker request body.
- **Defences:** **tamper-evident keyed hash-chain** audit (+ optional Ed25519 non-repudiation); TLS +
  broker **PSK seal**; **AES-256-GCM** sealed config with rekey-on-export; the broker **HMAC** covers
  the request body.

### Repudiation
- **Threats:** an actor (human or autonomous AI) denies an action.
- **Defences:** every action is audited with actor + status; the hash chain makes deletion/reordering
  detectable; Ed25519 signing upgrades to cross-party non-repudiation; **autonomous AI actors are
  keyed principals** with their own short-TTL sessions, so their actions are individually attributable.

### Information disclosure
- **Threats:** SSRF to cloud-metadata → IAM creds; leaking secrets in logs/errors; one user's cached
  read served to another; CSP-bypass data exfiltration; over-broad egress.
- **Defences:** **egress/SSRF guard** (metadata/link-local always blocked; optional allowlist);
  secret-scrubbed logging; **per-actor** cache + single-flight keys; strict **CSP** (+ nonce),
  `frame-ancestors 'none'`, COOP; **vendor API keys never stored** except AI keys in the encrypted
  vault; nothing-personal-at-rest by default.

### Denial of service
- **Threats:** request floods; a thundering herd amplifying load onto a rate-limited backend;
  long-lived SSE exhaustion; a runaway AI loop.
- **Defences:** per-user/IP **rate limiter** (Redis-shared at scale); **single-flight** read
  coalescing + adaptive cache shield the backend; SSE keepalive + graceful-shutdown drain; AI
  **kill-switch** + short-TTL autonomous sessions + per-capability gating.

### Elevation of privilege
- **Threats:** a viewer performing admin actions; bypassing the gateway gate; an enabled-but-disabled
  feature still reachable; a deprovisioned user retaining access; an autonomous actor exceeding scope.
- **Defences:** RBAC ladder + **backend re-authorizes every write** (gateway gate is defence-in-depth);
  **step-up** re-auth for the highest-risk actions; `requireFeature` 404s a disabled module at request
  time; **SCIM `active=false`** denies at the gate immediately on the handling replica (even mid-stream
  on an SSE) — fleet-wide needs a directory reload / rolling restart, see `docs/ops/MULTI-REPLICA.md`; the
  approved-actions matrix + vocab allowlist bound what any principal (incl. AI) may do.

## Key assumptions & residual risk

- **The gateway gate is defence-in-depth, not the sole authority** — the systems of record must
  enforce their own authz (the user's bearer token is forwarded).
- **Audit integrity is provable to a holder of the audit key**; enable **Ed25519 signing** for
  cross-party non-repudiation.
- **Per-replica state** (rate limit, presence, cache, latency EWMA) needs `REDIS_URL` to hold
  fleet-wide.
- **Local-vault key custody** ties at-rest secrecy to the env master key; use an external KMS/Vault
  backend for higher assurance.
- **OmniProject does not inspect brokered content** for malware/DLP beyond prompt DLP — that remains
  the backends' and the network edge's responsibility.

## Out of scope (deployer-owned)

Physical security; the IdP's own security (MFA/password policy); the backends' security; the host OS
and network; and any third-party penetration test of *your* deployment.
