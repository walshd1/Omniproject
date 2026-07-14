# Control evidence index — where each control is implemented & how to verify it

The auditor's "show me" companion to [COMPLIANCE.md](COMPLIANCE.md). Where COMPLIANCE.md maps
controls to frameworks (SOC 2 / ISO 27001 / NIST CSF), this maps each control to the **exact code
that implements it** and the **command, test or endpoint that proves it** — so a control can be
verified from a clean checkout without taking the claim on trust. Paths are relative to the repo root;
line numbers drift, so the named function/env is the durable anchor.

> **How to use.** `pnpm install` then run the per-row verification. Unit/integration proof runs offline
> (`node:test`/`vitest`); CI guards are in `.github/workflows/ci.yml`; runtime proof needs a running
> instance (`curl` the endpoint). "Test" columns point at the sibling `*.test.ts` that exercises the control.

## 1. Identity & access

| Control | Implemented in | Verify |
|---|---|---|
| OIDC (Auth Code + PKCE, JWKS verify) | `lib/oidc.ts` (`pkceChallenge` S256, `verifyIdToken`) | `lib/oidc.test.ts`, `__tests__/oidc-helpers.test.ts` |
| SAML 2.0 (signed assertions + replay) | `lib/saml.ts` (`validateSamlResponse`, `replayProtection`) | `lib/saml.test.ts`, `lib/saml-cache.test.ts` |
| SCIM provisioning + mid-session deprovision | `lib/scim.ts` (`directoryDecision`), `routes/scim.ts` | `__tests__/scim-routes.test.ts`; deprovision denial in `routes/index.ts` |
| RBAC roles + orthogonal authorities | `lib/rbac.ts` (`grantsFromClaims`, `requireRole`) | `lib/rbac.test.ts`, `__tests__/rbac-enforcement.test.ts` (real member≠admin) |
| Strong-auth (WebAuthn) gate for pmo/admin | `lib/rbac.ts` (`hasStrongAuth`, `STRONG_AMR`) | `__tests__/rbac-enforcement.test.ts` (amr-gated) |
| Step-up re-auth | `lib/step-up.ts` (`requireStepUp`) | `__tests__/security-routes.test.ts` (`code:"step_up_required"`) |
| Dual-control (four-eyes) | `lib/dual-control.ts` (`approve` rejects self) | `lib/dual-control.test.ts` |
| Default-deny chokepoint | `routes/index.ts` (`requireAuth` on every protected router) | `__tests__/security.test.ts` (401 without session) |

## 2. Session management

| Control | Implemented in | Verify |
|---|---|---|
| Idle + absolute timeout | `lib/session-timeout.ts` (`isSessionExpired`) | `lib/session-timeout.test.ts` |
| Revocation (key + per-user) | `lib/key-registry.ts` (`revokeUserSessions`) | `lib/key-registry.test.ts` |
| Concurrent-session cap | `lib/session-registry.ts` (`registerSession`) | `lib/session-registry.test.ts` |
| Cookie seal (AES-GCM) + flags | `lib/session-crypto.ts` (`seal`/`open`); `routes/auth.ts` (`httpOnly`,`sameSite`,`secure`) | `lib/session-crypto.test.ts` |

## 3. Cryptography & keys

| Control | Implemented in | Verify |
|---|---|---|
| AES-256-GCM primitive | `lib/crypto-aes-gcm.ts` | `__tests__/fuzz-crypto.test.ts` §1 |
| HKDF derivation + constant-time eq | `lib/crypto-keys.ts` (`deriveKey`, `constantTimeEqual`) | `__tests__/fuzz-crypto.test.ts` §2 |
| Config-at-rest (versioned, non-breaking) | `lib/config-crypto.ts` (`sealConfig` c2. / opens c1.) | `lib/config-crypto.test.ts` (incl. legacy-decrypt regression) |
| Vault secrets (versioned envelopes) | `lib/vault-store.ts` (`sealSecret` k2.) | `lib/vault-store.test.ts` |
| KMS / BYOK unwrap (AWS/Azure) | `lib/kms.ts` (`initKms`) | `lib/kms.test.ts` |
| External vault backends | `lib/vault-store.ts` (`BACKENDS`), `lib/vault-aws.ts`, `lib/vault-azure.ts` | `lib/vault-store.test.ts` |
| Tamper-evident audit chain | `lib/audit-chain.ts` (`sealAuditEvent`, `verifyAuditChain`) | `lib/audit-chain.test.ts`; runtime `GET /api/security/audit/verify` |
| Ed25519 anchor signing | `lib/signing.ts`, `lib/provenance.ts` | `lib/signing.test.ts`, `lib/provenance.test.ts` |

## 4. Network, egress & residency

| Control | Implemented in | Verify |
|---|---|---|
| SSRF/egress guard + post-DNS recheck | `lib/egress.ts` (`assertEgressAllowed`, injectable resolver) | `lib/egress.test.ts` (rebind, IPv6, metadata) |
| Sync URL-safety (config writes) | `lib/url-safety.ts` (`assertSafeOutboundUrl`) | `lib/url-safety.test.ts` |
| Data residency (fail-closed, 451) | `lib/data-residency.ts` (`assertResidency`) | `lib/data-residency.test.ts` |
| X-Forwarded-* fail-closed | `lib/trust-proxy.ts` (`resolveTrustProxy`) | `lib/trust-proxy.test.ts` |

## 5. Secrets, boot & error handling

| Control | Implemented in | Verify |
|---|---|---|
| Fail-closed SESSION_SECRET | `lib/session-secret-guard.ts` | `lib/session-secret-guard.test.ts` |
| Boot env validation (lengths, escapes) | `lib/env-config.ts` (`checkRequiredEnv`) | `lib/env-config.test.ts` |
| Dev-mode boot refusal in prod | `lib/dev-mode-guard.ts` | `lib/dev-mode-guard.test.ts` |
| Generic 5xx (no stack leak) | `lib/error-handler.ts` | `lib/error-handler.test.ts` |

## 6. Application hardening

| Control | Implemented in | Verify |
|---|---|---|
| Prototype-pollution reviver | `lib/safe-json.ts` (`safeParseJson`) | `lib/safe-json.test.ts`; `__tests__/config-dir.test.ts` (`__proto__` payload) |
| Payload / header guards (CRLF) | `lib/payload-guard.ts` | `lib/payload-guard.test.ts` |
| CSRF (origin + double-submit) | `lib/csrf.ts` (`csrfGuard`) | `lib/csrf.test.ts` |
| Security headers / CSP nonce | `app.ts` | `__tests__/security.test.ts` |
| Rate limiting | `lib/rate-limit.ts` | `lib/rate-limit.test.ts` |

## 7. Supply chain & runtime

| Control | Implemented in | Verify |
|---|---|---|
| Digest-pinned base + `--ignore-scripts` | `Dockerfile` | grep the `@sha256:` pin; CI `ci.yml` install steps |
| Non-root / read-only / dropped-caps | `deploy/helm/omniproject/values.yaml`; `k8s-enterprise-manifest.yaml` | `__tests__/helm-guard.test.ts` (asserts the posture) |
| SBOM + dependency scan | `.github/workflows/ci.yml` (`dependency-scan`: pnpm audit `--audit-level high`, CycloneDX) | CI job logs; [SUPPLY-CHAIN.md](SUPPLY-CHAIN.md) |
| Secret scanning (gitleaks) | `.github/workflows/ci.yml` (`secret-scan` job), `.gitleaks.toml` | CI `secret-scan` job logs |
| SAST (CodeQL) | `.github/workflows/codeql.yml` (`security-extended` pack) | CI `codeql` job logs / code-scanning alerts |
| Static taint scan (semgrep) | `.github/workflows/ci.yml` (`taint-scan` job), `.semgrep/omniproject.yml` | CI `taint-scan` job logs |
| Release build-provenance + SBOM attestation (SLSA, keyless) | `.github/workflows/release.yml` (`attest-build-provenance@v1`, `attest-sbom@v1`) | `gh attestation verify` against a release tag |
| Mutation testing (money/FX core) | `.github/workflows/mutation.yml`, `artifacts/omniproject/stryker.conf.json` | CI `mutation` job logs (break threshold enforced) |

## 8. Data governance & seam integrity

| Control | Implemented in | Verify |
|---|---|---|
| Zero-persistence above the seam | (guard) `scripts/src/guard-zero-at-rest-above-seam.ts` | `pnpm --filter @workspace/scripts run guard-zero-at-rest-above-seam` |
| Broker isolation (no vendor leakage) | (guard) `scripts/src/guard-broker-isolation.ts` | `pnpm --filter @workspace/scripts run guard-broker-isolation` |
| Broker↔gateway signed envelope (HMAC+PSK) | `lib/broker-hmac.ts` (+ Redis-gated fleet replay) | `lib/broker-hmac.test.ts` |
| Read-seam data sanitizer + data-quality signal | `broker/sanitizer.ts` (`wrapWithSanitizer`, wired `broker/index.ts`; strips `__proto__`/`constructor`/`prototype`), `lib/data-quality.ts` | `broker/sanitizer.test.ts`; runtime `X-OmniProject-Data-Repaired` response header |
| DSAR report (content-free) | `lib/dsar.ts` (`buildDsarReport`) | `lib/dsar.test.ts`; runtime `GET /api/security/dsar` |
| Retention / history | `history/retention.ts` (`recordWrite`, `buildTrend`) | `history/*.test.ts` |

## Whole-suite verification (one command each)

| Proof | Command |
|---|---|
| Gateway unit + integration suite | `pnpm --filter @workspace/api-server exec tsx --test "src/**/*.test.ts"` |
| SPA suite | `pnpm --filter @workspace/omniproject test` |
| Both seam guards | `pnpm --filter @workspace/scripts run guard-broker-isolation && … run guard-zero-at-rest-above-seam` |
| Codegen (contract/function-map) in sync | `pnpm --filter @workspace/scripts run gen-contract && … run gen-function-map` (no diff) |
| Compute-cost evidence | `pnpm --filter @workspace/api-server run bench` (see [ops/BENCHMARKS.md](ops/BENCHMARKS.md)) |

---

**See also:** [COMPLIANCE.md](COMPLIANCE.md) (framework mapping), [SECURITY-AUDIT.md](SECURITY-AUDIT.md)
(posture by domain), [THREAT-MODEL.md](THREAT-MODEL.md) (STRIDE), [SECURITY-QUESTIONNAIRE.md](SECURITY-QUESTIONNAIRE.md)
(vendor Q&A). This index is code-anchored — regenerate the line references with a grep for the named
functions if they've moved.
