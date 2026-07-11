# Proof-of-Value — success criteria & go/no-go gates

A runnable evaluation plan for a time-boxed paid Proof-of-Value (PoV / PoC). It defines **what
"success" means before you start**, the **entry and exit gates**, and **who signs off** — so the
decision at the end is a checklist, not a debate. It complements, and does not repeat:
[ops/PILOT-READINESS.md](ops/PILOT-READINESS.md) (the *technical* health checklist — probes, metrics,
smoke test), [QUICKSTART.md](QUICKSTART.md) / [SAFE-FIRST-RUN.md](SAFE-FIRST-RUN.md) (the safe
onboarding path), and [ENTERPRISE-READINESS.md](ENTERPRISE-READINESS.md) (the per-seat buyer view).

> **Why a PoV, specifically.** The product is a **stateless overlay**: its value proposition ("keep
> your tools, add a portfolio layer — nothing migrates") and its biggest risk (the broker forwarding
> must work against *your real backend*, and *your backend* must enforce per-user authorization) can
> only be proven against your own systems. This plan turns that into two hard gates (G4, G5).

## Scope & shape

- **Duration:** 4–6 weeks (2 weeks stand-up + integrate, 2–4 weeks in-use evaluation).
- **Environment:** your own infra (self-hosted), one stack for the PoV tenant (see the stack-per-tenant
  isolation model — no shared instance needed). Non-production or a read-only view of production data.
- **Backends in scope:** name them up front (e.g. Jira + one ERP). The PoV proves the connectors you'll
  actually depend on, not the whole catalogue.
- **Out of scope for the PoV:** third-party certification (an audit engagement, not a trial),
  multi-backend breadth beyond the named ones, and any feature the vendor flags as off-by-default/WIP.

## Entry gates (before the clock starts)

| # | Entry gate | Done when |
|---|-----------|-----------|
| E1 | Named success owner + stakeholders | An exec sponsor, an IT/security owner, and 2–3 end-user evaluators (PM/PgM/PMO) are named. |
| E2 | Scoped backends + a test data set | The 1–2 backends and the projects/programmes to evaluate are agreed and reachable. |
| E3 | IdP + roles ready | OIDC or SAML app registered; the five roles mapped to real IdP groups; SCIM token issued if used. |
| E4 | Security pre-read complete | Security reviewer has read [SECURITY.md](../SECURITY.md), [COMPLIANCE.md](COMPLIANCE.md), [CONTROL-EVIDENCE.md](CONTROL-EVIDENCE.md) and logged any blockers. |

## Success criteria (measurable)

### Functional value
| # | Criterion | Target / measure |
|---|-----------|------------------|
| F1 | Portfolio view derives with no data migration | Projects/programmes from the real backend appear in the overlay with **nothing synced or copied**. |
| F2 | The analytics the buyer cares about are correct | ≥ 3 named reports (e.g. EVM, RAG rollup, portfolio finance) reconcile against the backend's own numbers within an agreed tolerance. |
| F3 | Day-to-day workflows work for real users | The named evaluators complete their weekly routine (find work, update, comment, report) unaided after onboarding. |
| F4 | Exit is trivial | Uninstalling the stack leaves the backends untouched (proves the no-lock-in claim). |

### Non-functional
| # | Criterion | Target / measure |
|---|-----------|------------------|
| N1 | Latency is acceptable at your scale | On-the-fly derivation latency measured with the compute bench + real requests; p95 within the agreed budget (`BENCH_MAX_P99_MS` can gate it). See [ops/BENCHMARKS.md](ops/BENCHMARKS.md). |
| N2 | Health signals are wired | Liveness/readiness probes green, RED metrics scraping, error-capture confirmed. See [ops/PILOT-READINESS.md](ops/PILOT-READINESS.md). |
| N3 | HA path validated (if required) | With `REDIS_URL` set, ≥ 2 replicas serve without dropping SSE notifications. |

## 🔴 Go/no-go gates (the decision hinges on these)

| # | Gate | Pass when | Why it's a gate |
|---|------|-----------|-----------------|
| G1 | **Security review** | The reviewer signs off the audited posture *in your environment* (fail-closed boot, TLS, secrets in your vault/KMS, SIEM sink, NetworkPolicy). | The controls exist; they must be *operated* correctly in your deploy. |
| G2 | **SSO + JML** | A user provisioned via SCIM can sign in via your IdP; deprovisioning (`active=false`) locks them out **mid-session**. | Identity lifecycle is table-stakes for enterprise. |
| G3 | **RBAC enforced** | A viewer/contributor cannot perform PMO/admin actions; step-up is demanded for privileged operations. | Proves least-privilege end to end. |
| G4 | **Broker executes against your real backend** | The full broker contract runs against your *actual* n8n/broker + backend — create/read/update round-trips succeed (not just the demo broker). | The single highest-value unproven path (see the tech-debt register). |
| G5 | **Backend enforces per-user data authorization** | The gateway forwards a signed per-user/programme scope; **your backend confirms and enforces it** so a user only sees data they're entitled to. | The overlay delegates data-plane authz to the backend; this proves *your* side closes it. |

> **Rule:** all five 🔴 gates must pass for a "go." F/N criteria inform scoring; a G-gate failure is a
> stop — either remediate within the PoV window or record it as the reason for "no-go."

## Exit & sign-off

| Role | Signs off on |
|------|--------------|
| Exec sponsor | Overall value (F1–F4) + the business case. |
| IT / Security owner | G1–G5 + N1–N3. |
| End-user evaluators | F3 (their real workflows). |

Record the outcome as **Go / Go-with-conditions / No-go**, with each gate's status and, for anything
outstanding, the owner + remediation date. A "Go-with-conditions" typically lists the remaining
procurement items that are *not* PoV-solvable — third-party certification and a commercial
support/SLA arrangement — with a committed path for each (see [ENTERPRISE-READINESS.md](ENTERPRISE-READINESS.md)).

---

**See also:** [ops/PILOT-READINESS.md](ops/PILOT-READINESS.md) (technical readiness detail),
[ops/BENCHMARKS.md](ops/BENCHMARKS.md) (performance evidence),
[SECURITY-QUESTIONNAIRE.md](SECURITY-QUESTIONNAIRE.md) (vendor-security answers).
