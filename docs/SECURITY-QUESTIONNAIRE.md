# Vendor security questionnaire — standard response

A pre-filled response to the recurring vendor-security / third-party-risk questionnaires (CAIQ, SIG
Lite, VSA and their look-alikes). Each row is **question → short answer → evidence pointer** so a
reviewer can verify the claim rather than take it on trust. It does **not** restate the controls — it
points at the doc or the code that implements each one. For the framework control matrix
(SOC 2 / ISO 27001 / NIST CSF) see [COMPLIANCE.md](COMPLIANCE.md); for the data map / DSAR / DR
answers see [ENTERPRISE-OPS.md](ENTERPRISE-OPS.md).

> **Deployment context (read first).** OmniProject is a **self-hosted, stateless overlay** shipped as
> an Apache-2.0 container — the customer runs it in their own environment. So for most rows the honest
> answer is split: *the product provides control X; the customer's deployment operates it.* This is a
> shared-responsibility posture (see [COMPLIANCE.md](COMPLIANCE.md) §shared-responsibility). There is
> no OmniProject-operated SaaS holding customer data.

## A. Company, product & data flow

| # | Question | Answer | Evidence |
|---|----------|--------|----------|
| A1 | Is this a SaaS or self-hosted product? | **Self-hosted.** The customer deploys the container in their own cloud/on-prem; the vendor operates no multi-tenant service and holds no customer data. | [QUICKSTART.md](QUICKSTART.md), Dockerfile |
| A2 | What customer data do you store at rest? | **None by default.** It's a stateless overlay over the customer's existing systems of record (via an automation broker); nothing syncs or persists above the seam. Config (branding, connections) is sealed at rest; optional self-host storage is opt-in. | [ENTERPRISE-OPS.md](ENTERPRISE-OPS.md) §1 data map; CI guard `guard-zero-at-rest-above-seam` |
| A3 | Where is data processed / residency controls? | Fail-closed per-region routing; outbound blocked (HTTP 451) when a destination violates the configured policy. | [DATA-RESIDENCY.md](DATA-RESIDENCY.md); `lib/data-residency.ts` (`assertResidency`) |
| A4 | Sub-processors / third parties? | The overlay has none of its own; the customer's chosen backend + broker are their processors. Full outbound-destination inventory is published. | [PRIVACY.md](PRIVACY.md) sub-processor inventory; [ops/EGRESS-INVENTORY.md](ops/EGRESS-INVENTORY.md) |
| A5 | Multi-tenancy / tenant isolation model? | **Isolation-first: one stack per tenant.** Each tenant runs its own container/Helm release with its own config, secrets, vault, network policy and backend connections — no shared row-level tenancy, so there is no cross-tenant data-leak class. Cheap because the overlay is stateless (no per-tenant database). | `deploy/helm/omniproject` (release-per-tenant); `templates/networkpolicy.yaml`; per-stack `secret.yaml` |

## B. Identity & access management

| # | Question | Answer | Evidence |
|---|----------|--------|----------|
| B1 | SSO / federated identity supported? | OIDC (Auth Code + PKCE, JWKS signature verification), SAML 2.0 (signed assertions + response), and non-OIDC OAuth2. | `lib/oidc.ts`, `lib/saml.ts`, `lib/oauth2.ts`; [SSO-SCIM.md](SSO-SCIM.md) |
| B2 | Automated provisioning / deprovisioning (JML)? | SCIM 2.0 Users/Groups; `active=false` deprovisions and is enforced **mid-session** (a live session is denied on the next request). | `lib/scim.ts` (`directoryDecision`), `routes/scim.ts`; `routes/index.ts` deprovision gate |
| B3 | MFA / step-up for privileged actions? | Privileged authorities (PMO/admin) are gated on **strong auth** (WebAuthn/FIDO2 via RFC 8176 `amr`), plus a short-freshness **step-up** re-auth on sensitive operations. | `lib/rbac.ts` (`hasStrongAuth`), `lib/step-up.ts` (`requireStepUp`) |
| B4 | Authorization model / least privilege? | RBAC with a linear base ladder + orthogonal `pmo`/`admin` authorities; default-deny (`requireAuth`) on every protected route; per-user/programme data scope forwarded to the backend. | `lib/rbac.ts`, `routes/index.ts`; [ops/ROLES.md](ops/ROLES.md) |
| B5 | Separation of duties for high-risk changes? | Dual-control / maker-checker (four-eyes) — the approver cannot be the proposer. | `lib/dual-control.ts` (`approve` rejects same proposer) |
| B6 | Admin impersonation controls? | Dev-mode only, step-up gated, reason-required, time-boxed (30 min), and fully audited under the **real** admin identity. | `lib/impersonation.ts`, `routes/dev-mode.ts` |
| B7 | Session controls (timeout/revocation/cap)? | Idle + absolute timeout, per-user revocation, concurrent-session cap (newest-wins), sealed+signed cookies re-validated every request. | `lib/session-timeout.ts`, `lib/session-registry.ts`, `lib/session-crypto.ts` |

## C. Encryption & key management

| # | Question | Answer | Evidence |
|---|----------|--------|----------|
| C1 | Encryption at rest? | AES-256-GCM for every sealed artifact (session cookie, config, vault secrets), keyed via HKDF-SHA256 with domain separation. | `lib/crypto-aes-gcm.ts`, `lib/crypto-keys.ts` (`deriveKey`); `lib/config-crypto.ts`, `lib/vault-store.ts` |
| C2 | Encryption in transit? | TLS terminated at the customer's ingress; HSTS emitted under TLS; all outbound is SSRF-guarded HTTPS. | `app.ts` (HSTS); `lib/egress.ts` (`safeFetch`) |
| C3 | Key management / BYOK / HSM? | Layered: env master → HKDF → optional KMS/BYOK unwrap (AWS KMS, Azure Key Vault); secrets can live in HashiCorp/AWS/Azure vaults instead of the local store. Keys are versioned + rotatable. | `lib/kms.ts`, `lib/vault-store.ts` (backends), `lib/key-registry.ts` |
| C4 | Secret handling / no hardcoded secrets? | Fail-closed boot: refuses to start with a default/missing `SESSION_SECRET`; `BROKER_PSK`/`SCIM_TOKEN` length-checked; secrets redacted in logs; generic 5xx (no stack leak). | `lib/session-secret-guard.ts`, `lib/env-config.ts` (`checkRequiredEnv`), `lib/error-handler.ts` |

## D. Application & infrastructure security

| # | Question | Answer | Evidence |
|---|----------|--------|----------|
| D1 | Input validation / injection defence? | Prototype-pollution-safe JSON reviver on every body, payload/identifier guards (CRLF, control chars), typed bounded schemas; the gateway executes **no SQL** (parameterised SQL lives in the backend). | `lib/safe-json.ts`, `lib/payload-guard.ts` |
| D2 | CSRF / clickjacking / headers? | Origin + double-submit CSRF, per-request CSP nonce, `nosniff`, frame-DENY, COOP, Permissions-Policy, body-size cap. | `lib/csrf.ts`, `app.ts` (security headers) |
| D3 | SSRF / outbound abuse? | Egress guard blocks link-local/metadata + rechecks **every DNS-resolved IP** (anti-rebind), fails closed on DNS error; optional strict `EGRESS_ALLOWLIST`. | `lib/egress.ts` (`assertEgressAllowed`) |
| D4 | Rate limiting / DoS resistance? | Per-IP limiters for API, analytics and login (Redis-shared across replicas). | `lib/rate-limit.ts` |
| D5 | Container / runtime hardening? | Non-root, read-only root FS, all capabilities dropped, seccomp RuntimeDefault, digest-pinned base image, `--ignore-scripts` installs; optional NetworkPolicy. | Dockerfile; `deploy/helm/omniproject/values.yaml`; `templates/networkpolicy.yaml` |
| D6 | Network segmentation? | Opt-in NetworkPolicy targeting only the gateway pods (DNS always allowed; ingress source + strict egress configurable). | `deploy/helm/omniproject/templates/networkpolicy.yaml` |

## E. Logging, monitoring & assurance

| # | Question | Answer | Evidence |
|---|----------|--------|----------|
| E1 | Audit logging / tamper evidence? | Every audited event is sealed into a keyed **tamper-evident hash chain**; an optional Ed25519 anchor adds non-repudiation. | `lib/audit.ts`, `lib/audit-chain.ts`, `lib/signing.ts` |
| E2 | SIEM integration? | Structured NDJSON audit stream to a customer SIEM endpoint (batched); Prometheus RED metrics + OTLP spans. | `lib/audit.ts` (`createHttpSink`); [ops/PILOT-READINESS.md](ops/PILOT-READINESS.md) §2 |
| E3 | Vulnerability disclosure / pen-test invited? | Published policy with rules-of-engagement + safe-harbour; an in-repo zero-trust code audit and STRIDE threat model. | [SECURITY.md](../SECURITY.md); [ZERO-TRUST-AUDIT-2026-07.md](archive/reviews/ZERO-TRUST-AUDIT-2026-07.md); [THREAT-MODEL.md](THREAT-MODEL.md) |
| E4 | Supply-chain security / SBOM? | CycloneDX SBOM + licence inventory, `pnpm audit` gate, gitleaks secret-scan, digest-pinned base, 1-day dependency quarantine in CI. | [SUPPLY-CHAIN.md](SUPPLY-CHAIN.md); `.github/workflows/ci.yml` (`dependency-scan`) |

## F. Privacy, BC/DR & compliance

| # | Question | Answer | Evidence |
|---|----------|--------|----------|
| F1 | DSAR / erasure support? | `GET /api/security/dsar` builds a subject report (SCIM record, revocation mark, content-free provenance refs, systems-of-record pointers) — it never copies backend data. | `lib/dsar.ts`; [ENTERPRISE-OPS.md](ENTERPRISE-OPS.md) §2 |
| F2 | Controller/processor position & DPA? | Position + GDPR Art. 30 ROPA template + DPA stance documented. | [PRIVACY.md](PRIVACY.md) |
| F3 | Backup / RPO / RTO / DR runbook? | Because the overlay is stateless, DR is redeploy-from-config; RPO/RTO + runbook documented. | [ENTERPRISE-OPS.md](ENTERPRISE-OPS.md) §4–§5 |
| F4 | Certifications (SOC 2 / ISO 27001)? | **Not yet certified.** A control-to-framework mapping (SOC 2 TSC / ISO 27001 Annex A / NIST CSF 2.0) and an auditor evidence index are maintained; self-hosting in the customer's own attested environment folds the runtime under their existing ISMS. | [COMPLIANCE.md](COMPLIANCE.md); [CONTROL-EVIDENCE.md](CONTROL-EVIDENCE.md) |
| F5 | Accessibility conformance? | WCAG 2.1 AA / VPAT-style ACR published. | [ACCESSIBILITY-CONFORMANCE.md](ACCESSIBILITY-CONFORMANCE.md) |

---

> **Honest scope.** Answers describe controls the product *ships*; the customer's deployment *operates*
> them (TLS termination, secret storage, backup cadence, SIEM endpoint). The one item that is neither
> shipped nor operable by config is third-party **certification** (F4) — that is an audit engagement,
> not a feature. See [ENTERPRISE-READINESS.md](ENTERPRISE-READINESS.md) for the buyer-panel view and
> [POV-SUCCESS-CRITERIA.md](POV-SUCCESS-CRITERIA.md) for the evaluation go/no-go gates.
