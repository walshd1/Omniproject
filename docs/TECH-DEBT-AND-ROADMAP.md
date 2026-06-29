# Technical debt & roadmap

A living, honest register of known limitations, deferred work, and where the product goes
next. It is deliberately candid — "honest scope" notes scattered through `docs/AI-SECURITY.md`
and commit messages are consolidated here so reviewers and operators have one place to look.

Status legend: **[debt]** something to pay down · **[gap]** not built yet · **[caveat]** a
deliberate, documented limitation (not a defect) · **[idea]** worth doing, unscoped.

---

## 1. Verification gaps (highest priority)

These are the items most likely to bite in production, because they're verified against
**mocks**, not the real third parties.

- **[caveat] External secret/KMS adapters are mock-verified only.** The native AWS Secrets
  Manager (SigV4), Azure Key Vault (AAD), HashiCorp/HCP, and the KMS/BYOK unwrap paths
  (`lib/vault-aws`, `lib/vault-azure`, `lib/vault-store`, `lib/kms`, `lib/aws-sigv4`) are
  exercised against a stubbed `fetch`. The wire shapes and signing construction are tested, but
  not a single call has hit a live cloud endpoint.
  **Action:** a one-time smoke test per backend against a real account; capture the exact IAM
  policy / Key Vault access policy / Vault policy needed, and add to the deploy docs.
- **[caveat] OTLP export is mock-verified.** `lib/tracing` builds and POSTs an OTLP/JSON span
  but hasn't been validated end-to-end against a Datadog/Jaeger/Tempo collector.
  **Action:** smoke test against one OTLP collector; confirm trace/span IDs render and the
  broker hop joins the same trace.
- **[caveat] The Authentik blueprint is not applied against a live Authentik.**
  `infra/authentik/blueprints/omniproject.yaml` is written to the documented schema but
  blueprint syntax is version-specific. The manual steps in `docs/DEPLOY-LOCAL.md` remain the
  fallback source of truth.
  **Action:** bring up the standalone stack, confirm the app + `omni-*` groups + the `groups`
  claim materialise, and pin the verified Authentik version.

---

## 2. State that is RAM-only / per-replica

The gateway is stateless by design, but several runtime registries are in-process memory.
Single-instance deployments are fine; behind N replicas these don't share state. A shared store
(Redis is already wired for rate-limit + the broker-log bus) would make them global.

- **[caveat] Concurrent-session cap** (`lib/session-registry`) is per-replica RAM — a user
  could hold up to `cap × replicas` sessions.
- **[caveat] Maker-checker proposal queue** (`lib/dual-control`) is per-replica — a proposal
  raised on replica A isn't approvable on replica B.
- **[caveat] Audit-chain head** (`lib/audit-chain`) is in-memory unless `AUDIT_CHAIN_FILE` is
  set; across replicas each has its own chain (the SIEM copy is still self-verifying per event).
- **[debt] The settings store** (`lib/settings`) is in-memory, seeded from env/config-dir.
  Runtime changes (incl. the deployment profile) are per-replica until a config-dir reload.
  **Action:** an optional shared backing (Redis/Postgres) behind the same accessors; or document
  that runtime settings changes need the config-dir + a rolling restart for fleet consistency.

**Roadmap:** a single `SHARED_STATE` seam (Redis) that these registries opt into, mirroring the
existing rate-limit/broker-log pattern.

---

## 3. Security model — deliberate boundaries

These are documented in `docs/AI-SECURITY.md §6`; restated here so they're not "discovered".

- **[caveat] Shared-secret MACs, not signatures.** Provenance + the audit chain authenticate to
  a holder of the master (tamper-**evident**), not non-repudiation against the gateway itself.
  Asymmetric signing would be needed for that.
- **[caveat] Internal-consistency provenance.** Order + non-alteration are verified internally
  (monotonic counter + hash links) with no external time anchor; a holder of *both* the
  provenance and broker keys could forge a self-consistent history.
- **[caveat] Encryption protects data at rest**, not against someone holding the master/process.
- **[caveat] Prompt injection is mitigated, not eliminated** (closed vocab, schema-bound args,
  default-deny writes, human confirm); containment ensures the worst case is a refused/clarifying
  response, not a silent action.

**Roadmap [idea]:** optional asymmetric signing (Ed25519) for the audit chain + provenance, to
move from tamper-evident to non-repudiation for customers who need it.

---

## 4. Not built yet (designed or deferred)

- **[gap] Multi-tenancy.** Designed end-to-end in `docs/MULTI-TENANCY-DESIGN.md` (tenant context
  via AsyncLocalStorage, per-tenant config/vault/keys, fail-closed broker scoping, isolation test
  matrix) but **not implemented**. Single-tenant today. Needs the 5 open decisions in that doc
  answered before Phase 1 (tenant-context plumbing).
- **[idea] MD RAG persona files.** Experienced PM/PgM methodological personas as retrieval files
  for the copilot — recommended, not built (awaiting go-ahead). *(Partially shipped: the copilot
  now lenses answers through methodology personas authored as catalogue JSON; standalone
  retrieval `.md` files are the remaining idea.)*
- **[idea] DSAR tooling beyond docs.** `docs/ENTERPRISE-OPS.md` documents the (stateless) DSAR
  story; a one-click "what we hold for subject X" report could automate the evidence.

---

## 5. Smaller debt / cleanups

- **[debt] `deploymentProfile` isn't in the OpenAPI `Settings` schema.** It's a real persisted
  setting but was added as an optional field set via `POST /api/setup/profile` (not the generated
  client) to avoid codegen churn. Fold it into `openapi.yaml` + regen for consistency.
- **[debt] Cookie `secure` vs HSTS resolution.** Both now follow `requireTls()`, but the cookie's
  static `cookieBase.secure` (module-load) is overridden per-set; the static default is only used
  for `clearCookie`. Minor — could compute it in one place.
- **[debt] Two profile sources of truth.** `DEPLOYMENT_PROFILE` env (boot/security-check) vs the
  persisted setting (runtime override). Intentional, but document the precedence prominently so
  it's not surprising.
- **[debt] Large branch / changelog churn.** The last integration was 85 commits; keep future
  work in smaller, single-concern PRs to ease review and reduce changelog conflicts.
- **[gap] Auth/abuse hardening from the pentest pass (deferred).** Login-rate-limit on the demo
  session endpoint, an OIDC `nonce` check, an SSE deprovision re-check on long-lived streams, and
  a CSP `nonce` (replace `unsafe-inline`). Each independent and self-contained.

---

## 6. Suggested sequencing

1. **Verification sweep (§1)** — smoke-test the cloud adapters, OTLP, and the Authentik
   blueprint against real services; pin versions + capture required IAM/policies. *Highest ROI;
   de-risks everything already shipped.*
2. **Shared-state seam (§2)** — Redis-backed option for the RAM-only registries, so the hardening
   behaves correctly behind multiple replicas.
3. **Multi-tenancy Phase 1 (§4)** — only if the GTM needs pooled tenancy; start with
   tenant-context plumbing behind a `currentTenant()` shim (no behaviour change).
4. **Governance UX + personas (§4)** — wizard governance walkthrough + the MD RAG personas.
5. **Non-repudiation option (§3)** — asymmetric signing for audit/provenance, for regulated
   customers.

---

*Keep this current: when you ship something here, delete the line; when you find new debt, add
one. A short, true list beats a long, aspirational one.*
