# Compliance control mapping

This maps OmniProject's **existing, implemented** controls to the frameworks a security review or
procurement questionnaire checks against: **SOC 2** (Trust Services Criteria), **ISO/IEC 27001:2022**
(Annex A), and the **NIST Cybersecurity Framework (CSF) 2.0**. It is the procurement-facing companion
to the engineering-level [`SECURITY-AUDIT.md`](./SECURITY-AUDIT.md) and the operational
[`ENTERPRISE-OPS.md`](./ENTERPRISE-OPS.md).

> **Status disclaimer.** This is a **control-mapping / readiness** document, not a certification.
> OmniProject is open, self-hostable software; a SOC 2 Type II report or ISO 27001 certificate
> attaches to an *operating organisation*, not to source code. Use this to evidence that the product
> *provides* the technical controls your own attested environment relies on.

## Shared-responsibility model

OmniProject is a **stateless overlay gateway**. It does not own your user directory or your project
data — the IdP authenticates, and the systems of record (Jira, OpenProject, …) store and authorize.
So responsibility splits:

| Layer | Owner | Examples |
| --- | --- | --- |
| Identity & user lifecycle | **You / your IdP** | password policy, MFA, joiner-mover-leaver |
| Project/work data at rest | **Your backends** | encryption, retention, residency of issue data |
| The gateway & its controls | **OmniProject (product)** | the controls tabulated below |
| Deployment & operations | **You (the deployer)** | TLS certs, secrets, patching cadence, monitoring |

## Control matrix

| Control area | OmniProject implementation | SOC 2 (TSC) | ISO 27001:2022 (Annex A) | NIST CSF 2.0 |
| --- | --- | --- | --- | --- |
| Authentication | OIDC / OAuth2-PKCE / SAML / magic-link; read-only API tokens | CC6.1 | A.5.16, A.8.5 | PR.AA-01/02 |
| Authorization (RBAC) | Role ladder + admin/PMO authorities; the gateway enforces role + data-scope on every request. Object-level re-authorization is applied by the system of record — your backend, or the built-in reference broker, which enforces scope on writes (fine-grained/per-object ACLs at the gateway are on the roadmap) | CC6.1, CC6.3 | A.5.15, A.8.3 | PR.AA-05 |
| Joiner-mover-leaver | SCIM 2.0 lifecycle; `active=false` denies at the gate (immediate on the handling replica; fleet-wide within the sync interval via shared state when `REDIS_URL` is set — see `docs/ops/MULTI-REPLICA.md`) | CC6.2, CC6.3 | A.5.16, A.5.18 | PR.AA-01 |
| Session management | Sealed cookie; sliding idle + absolute cap; step-up re-auth | CC6.1 | A.8.5 | PR.AA-03 |
| Least privilege / step-up | Re-auth required for key revocation, egress/governance, raw escape hatch | CC6.3 | A.8.2 | PR.AA-05 |
| Secrets management | Pluggable vault (local AES-GCM **or** HashiCorp/AWS/Azure KMS); BYOK envelope | CC6.1 | A.8.24 | PR.DS-01 |
| Encryption in transit | TLS at the edge; gateway↔broker PSK seal | CC6.7 | A.8.24 | PR.DS-02 |
| Encryption at rest | AES-256-GCM sealed config; rekey-on-export | CC6.7 | A.8.24 | PR.DS-01 |
| Integrity / non-repudiation | Tamper-evident keyed audit hash-chain; optional Ed25519 anchor signing | CC7.1, CC7.2 | A.8.15 | PR.DS-06, DE.AE-03 |
| Request integrity (seam) | Per-session broker HMAC + nonce (replay/forgery defence) | CC6.7 | A.8.24 | PR.DS-02 |
| Audit logging | Structured, level-gated audit to stdout/SIEM; self-verifying hash-chain. Delivery to an external sink is best-effort/in-memory-buffered, and the chain head persists across restarts **only when `AUDIT_CHAIN_FILE` (or shared KV) is configured** — set a durable sink + chain anchor for an auditor-grade trail | CC7.2 | A.8.15, A.8.16 | DE.AE-02/03 |
| Boundary protection | Egress/SSRF guard (metadata/link-local blocked; optional allowlist); `IP_ALLOWLIST` | CC6.6 | A.8.20, A.8.22 | PR.IR-01 |
| Web hardening | CSP+nonce, HSTS, COOP, `frame-ancestors`, nosniff, Referrer/Permissions-Policy; CSRF (Origin + double-submit) | CC6.6, CC6.7 | A.8.26 | PR.PS-05 |
| Rate limiting / DoS | Per-user/IP limiter; Redis-shared under scale | A1.1 | A.8.6 | PR.IR-04 |
| Vulnerability mgmt | Dependabot; CI `dependency-scan` (pnpm audit + CycloneDX SBOM); CodeQL SAST; semgrep taint-scan; gitleaks secret-scan; 1-day dependency quarantine (`minimumReleaseAge`); `SECURITY.md` disclosure policy | CC7.1 | A.8.8 | ID.RA-01, PR.PS-02 |
| Change management | CI gates (typecheck, tests, drift guards, e2e) on every change; PR review | CC8.1 | A.8.32 | PR.PS-06 |
| Config / secure baseline | Hardened container (read-only fs, cap-drop, no-new-privileges, non-root); compose guard | CC7.1 | A.8.9 | PR.PS-01 |
| Data subject rights | DSAR evidence report; erasure guidance | P-series, C1.1 | A.5.34 | GV.OC |
| Retention & disposal | The gateway holds no project data at rest by default. Its **optional** durable history/snapshot store (operator-enabled, in your own Postgres/archive) currently retains snapshots **indefinitely** — configurable retention windows, disposal jobs and legal-hold/erasure are the deploying organisation's policy today and a roadmap gap (not yet a first-party feature). Audit/security events that leave the gateway to your SIEM/log sink are retained per your policy | C1.2 | A.8.10 | PR.DS-03 |
| Resilience / DR | Persistable sealed config + vault stores (point `CONFIG_STORE_FILE` / vault persistence at a backed-up volume or an external KMS; both are in-memory/ephemeral by default); documented DR runbook (RTO/RPO). Backup **scheduling** of those stores and the durable history DB is a deployer responsibility — no first-party backup job ships yet | A1.2, A1.3 | A.5.29, A.8.13/14 | RC.RP-01 |
| Availability / scale | Horizontal replicas + shared state; single-flight + adaptive cache | A1.1 | A.8.6 | PR.IR-03 |
| AI governance | No-AI-by-default; tri-state capability gating; prompt DLP; kill-switch | CC1.x, CC5.x | A.5.1, A.8.* | GV.RM, GV.SC |

## Evidence pointers

- Engineering detail per control → [`SECURITY-AUDIT.md`](./SECURITY-AUDIT.md).
- Data map, DSAR, retention, backup & DR runbook → [`ENTERPRISE-OPS.md`](./ENTERPRISE-OPS.md).
- AI control model → [`AI-SECURITY.md`](./AI-SECURITY.md).
- Outbound destinations / sub-processor basis → [`EGRESS-INVENTORY.md`](./ops/EGRESS-INVENTORY.md).
- Privacy / records of processing → [`PRIVACY.md`](./PRIVACY.md).
- Accessibility conformance → [`ACCESSIBILITY-CONFORMANCE.md`](./ACCESSIBILITY-CONFORMANCE.md).
- Threat model → [`THREAT-MODEL.md`](./THREAT-MODEL.md).

## Gaps a deploying organisation still owns

These are **deployment** responsibilities the product can't satisfy on your behalf — list them in
your own SoA/ISMS: an attested SOC 2/ISO environment, a third-party penetration test on *your*
deployment, your IdP's MFA/password policy, your backends' data residency, and your monitoring/alerting
on the audit stream.
