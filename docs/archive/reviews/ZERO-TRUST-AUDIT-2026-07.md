# Zero-Trust Audit — API gateway (2026-07)

**Scope:** `artifacts/api-server` (gateway). Static code review across five zero-trust
dimensions, with the highest-severity findings re-verified in code. The out-of-process
broker/backend sidecar is **not** in this repo and was not assessed.

## Verdict

Identity, cryptography, perimeter, secrets, and service-to-service auth are **enterprise-grade
and largely fail-closed**. The one *systemic* weakness is the **data plane**: the gateway does
not enforce per-user / per-object authorization — it delegates that to the backend — and for
SAML / OAuth2 / magic-link identities it *structurally cannot* (placeholder tokens), leaving
coarse global RBAC as the sole control. Everything else is hardening.

## Findings

| # | Sev | Area | Summary | Issue |
|---|-----|------|---------|-------|
| H1 | High | Data authz | SAML/OAuth2/magic-link carry a placeholder `accessToken` (`auth.ts:465/537/571`), forwarded as `Bearer saml`; backend can't scope per-user → any `contributor` can touch any project's data | [#488](../../../../issues/488) |
| H2 | High | Data authz | IDOR/BOLA: `routes/projects.ts` write gates are a global role only, no ownership check on `:projectId`/`:issueId` | [#488](../../../../issues/488) |
| H3 | Med | Data authz | Broker reads use `withActor:false` — no actor context forwarded for per-user read decisions | [#488](../../../../issues/488) |
| M1 | Med-High | SSRF | AI (`ai.ts`) & STT (`stt.ts`) endpoints fetched raw, runtime-settable, bypassing egress allowlist + residency; residency comment falsely claimed AI covered | [#489](../../../../issues/489) ✅ fixed |
| M2 | Med | SSRF | JWKS / OAuth2 token+userinfo / reachability probe use literal-only guard (no post-DNS recheck) → DNS-rebind; inconsistent with OIDC's `safeFetch` | [#490](../../../../issues/490) |
| L1 | Low | Authz consistency | Dev-mode impersonation authorized via `roleFromClaims` (skips strong-auth/SCIM/deprovision) instead of `requireRole` | [#491](../../../../issues/491) ✅ fixed |
| L2 | Low | Authz consistency | `views`/`dashboards` writes ungated vs `pmo`-gated siblings (documented-intentional — flagged for decision) | [#491](../../../../issues/491) |
| L3 | Low | Least privilege | `snapshots/capture` signed arbitrary data at `requireAuth` only; audit mislabeled `admin` | [#491](../../../../issues/491) ✅ fixed |
| L4 | Low | Secrets | No independent strength check for at-rest master keys / `BROKER_PSK` (single-secret blast radius via fallback chain) | [#491](../../../../issues/491) |
| — | Low | Crypto | rate-card key derivation uses bare SHA-256 instead of HKDF `deriveKey` | [#486](../../../../issues/486) |
| — | Low | SAML | No replay protection (`validateInResponseTo` / assertion-ID cache) | [#487](../../../../issues/487) |

✅ = addressed in the accompanying hardening PR (M1, L1, L3). H1/H2 need a design decision;
M2/L2/L4 are tracked.

## What holds up (verified strong)

- **Fail-closed boot:** refuses to start with default/missing `SESSION_SECRET` under production
  signals; live broker refuses without `BROKER_PSK`; dev-mode hard-off in production.
- **Crypto & secrets at rest:** AES-256-GCM sealed everything, HKDF domain separation, session
  cookie both signed and sealed, log redaction, generic 5xx (no stack leak).
- **Identity/authz:** WebAuthn strong-auth step-up is *structural* for admin/pmo, dual-control on
  destructive ops, `requireAuth` blankets the protected surface, no client-role/network-position
  trust, `X-Forwarded-*` fail-closed.
- **Continuous validation:** every request re-checks cookie seal + idle/absolute timeout +
  revocation + concurrent-session cap + SCIM deprovision. Impersonation is dev-only, admin-only,
  step-up, time-boxed, audited.
- **Service-to-service:** broker HMAC + PSK envelope, webhook/SCIM/API-token/notify-ingest all
  constant-time with real secrets.
- **Injection:** none — parameterized SQL, systemic prototype-pollution reviver, no
  `eval`/`child_process`/path-traversal.
- **Supply chain / runtime:** 1-day quarantine, `--ignore-scripts`, digest-pinned base, non-root
  + read-only + dropped-caps containers.

## Method & caveats

Five parallel dimension audits (authorization coverage; SSRF/service-auth; injection/input;
secrets/transport/boot; data-isolation/session). Static review only — no runtime exploitation,
no independent pentest. The broker/backend sidecar's own per-object authorization (on which H1/H2
containment depends under OIDC) is out of repo and unverified.
