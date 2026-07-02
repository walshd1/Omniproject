# Documentation index

A map of every document in `docs/`, grouped by what it's for and who it's for. This
page doesn't duplicate content — each entry is one line; follow the link for the
real thing. Start with **[TECHNICAL.md](TECHNICAL.md)** if you just want the single
technical reference; use this page when you need something more specific (an
audit, a runbook, a design proposal).

For the install/deploy/use guide and the three audience "doors" (small teams &
charities / enterprises / engineers), see the **[README](../README.md)**.

---

## Architecture & internals

How the system is put together, the broker seam, and the extensibility model.

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — the system overview: stateless / zero-at-rest model, the layer cake, the broker seam, the security spine, dev-mode gating (Mermaid diagrams).
- **[SEQUENCES.md](SEQUENCES.md)** — seven traced sequence walkthroughs (auth, broker read, optimistic-concurrency write, capability resolution, snapshot sign/verify, notification dispatch, dev-mode gating).
- **[READING-GUIDE.md](READING-GUIDE.md)** — subsystem → entry-point-file map, plus a glossary of the domain vocabulary.
- **[FUNCTION-MAP.md](FUNCTION-MAP.md)** — the generated per-function index of every source file (CI-drift-guarded).
- **[BROKER.md](BROKER.md)** — the `Broker` interface seam and its invariants (why the codebase can't know the broker is n8n).
- **[BROKER-HTTP-BINDING.md](BROKER-HTTP-BINDING.md)** — the reference HTTP wire protocol a contract-speaking broker implements (what n8n implements today, and what a sidecar broker would implement to plug in with zero core changes).
- **[CONTRACT.md](CONTRACT.md)** — the published, versioned `Broker` contract (request/response shapes, control semantics), generated from source.
- **[INTEGRATION-PLANES.md](INTEGRATION-PLANES.md)** — the seven integration planes (backends, brokers, outputs, notifications, methodologies, reports, screens) and the shared catalogue.
- **[vendors/ORACLE-FUSION-ERP.md](vendors/ORACLE-FUSION-ERP.md)** — the Oracle Fusion Cloud ERP (Project Financial Management) connector: what's genuinely mapped, and why it's catalogued but not yet live-tenant-verified.
- **[METHODOLOGIES.md](METHODOLOGIES.md)** — the methodology views (Kanban, Scrum, Gantt, PRINCE2, RAID, list) and how to add your own.
- **[FEATURE-MODULES.md](FEATURE-MODULES.md)** — optional, lazily-loaded backend modules an operator can switch off.
- **[FEATURE-GOVERNANCE.md](FEATURE-GOVERNANCE.md)** — how features/methodologies/reports are gated across org → programme → project.
- **[DATA-REQUIREMENTS.md](DATA-REQUIREMENTS.md)** — what each view/report needs from the underlying backend, and how it degrades when the data isn't there.
- **[FIELD-CATALOGUE.md](FIELD-CATALOGUE.md)** — the cross-product field superset used to extend the canonical field registry.
- **[SELF-HOST-DB.md](SELF-HOST-DB.md)** — the optional, customer-owned stateful database for greenfield teams with nothing to connect.
- **[N8N-WORKFLOWS.md](N8N-WORKFLOWS.md)** — generate, wire & verify n8n workflows; open vs. licensed prebuilt integrations.
- **[MCP.md](MCP.md)** — the read-only (write opt-in) MCP server so an AI agent can read through the broker seam.
- **[MULTI-TENANCY-DESIGN.md](MULTI-TENANCY-DESIGN.md)** — *(design proposal, not implemented)* pooled multi-tenancy for a SaaS/MSP deployment model.
- **[STAGE-GATES-DESIGN.md](STAGE-GATES-DESIGN.md)** — *(design, not implemented)* maker-checker governance gates for plan-affecting changes, and the zero-at-rest constraint that has to be resolved first.
- **[PARKED-DECISIONS.md](PARKED-DECISIONS.md)** — items surfaced by review that need a maintainer decision before building, with the recommended call for each.

## Security & compliance

Controls, audits, and the frameworks they map to.

- **[SECURITY-AUDIT.md](SECURITY-AUDIT.md)** — the consolidated security posture: every control, where it's implemented, and residual risk.
- **[SECURITY-AUDIT-2026-07.md](SECURITY-AUDIT-2026-07.md)** — a focused re-audit of the surfaces added or changed since the last pentest pass.
- **[AI-SECURITY.md](AI-SECURITY.md)** — the end-to-end AI control model: what's gated, contained, and the residual boundaries.
- **[THREAT-MODEL.md](THREAT-MODEL.md)** — a STRIDE threat model and trust boundaries, for security review and pen-test scoping.
- **[COMPLIANCE.md](COMPLIANCE.md)** — control mapping to SOC 2, ISO/IEC 27001:2022 and NIST CSF 2.0.
- **[PRIVACY.md](PRIVACY.md)** — controller/processor position, GDPR Article 30 records of processing, and the DPA position.
- **[SUPPLY-CHAIN.md](SUPPLY-CHAIN.md)** — SBOM generation, dependency advisories, and open supply-chain items.
- **[DATA-RESIDENCY.md](DATA-RESIDENCY.md)** — the fail-closed per-region routing control for the broker egress hop.
- **[SSO-SCIM.md](SSO-SCIM.md)** — the SAML 2.0 SSO + SCIM 2.0 provisioning/deprovisioning runbook, with Okta/Entra/Google Workspace examples.
- **[ACCESSIBILITY-CONFORMANCE.md](ACCESSIBILITY-CONFORMANCE.md)** — the WCAG 2.1 AA conformance report (VPAT-style), procurement-facing.
- **[ops/EGRESS-INVENTORY.md](ops/EGRESS-INVENTORY.md)** — every outbound destination the gateway can reach.
- **[ops/ROLES.md](ops/ROLES.md)** — the RBAC model (base ladder + PMO/admin authorities) in product terms.

## Operations & scale

Running it in production.

- **[OPERATIONS.md](OPERATIONS.md)** — scaling, high availability, disaster recovery & backup, and enabling OTLP telemetry.
- **[SCALING.md](SCALING.md)** — how OmniProject stays fast and gentle on backend rate limits as usage grows; companion to `ops/MULTI-REPLICA.md`.
- **[DEPLOY-LOCAL.md](DEPLOY-LOCAL.md)** — the standalone stack (bundled Authentik IdP, Traefik, local-CA TLS) for fastest evaluation.
- **[REVERSE-PROXY.md](REVERSE-PROXY.md)** — putting `omni-shell` behind an existing Traefik / Caddy / nginx.
- **[COMPOSE-AUDIT.md](COMPOSE-AUDIT.md)** — the Docker Compose topology correctness audit and the CI checks that keep it correct.
- **[ENTERPRISE-OPS.md](ENTERPRISE-OPS.md)** — the data map, DSAR, retention and backup/DR answers procurement asks for.

## Product & buyer

Fit, maturity, and evaluation.

- **[ENTERPRISE-READINESS.md](ENTERPRISE-READINESS.md)** — the buyer-panel gap analysis (CEO, Finance, Compliance, CISO, IT, Projects).
- **[SME-CHARITY-FIT.md](SME-CHARITY-FIT.md)** — an audit of whether OmniProject still serves small orgs and charities as first-class users.
- **[SMALL-ORG-GUIDE.md](SMALL-ORG-GUIDE.md)** — the non-technical walkthrough for small teams, charities and self-hosters.
- **[SAFE-FIRST-RUN.md](SAFE-FIRST-RUN.md)** — the step-by-step path to evaluating against real data safely (dry-run, read-only first).
- **[FEATURE-MATURITY.md](FEATURE-MATURITY.md)** — a feature-by-feature maturity read: stable / beta / prototype / nominal, plus the buried debt.
- **[TESTING.md](TESTING.md)** — the test pillars and the CI coverage gates.
- **[TECH-DEBT-AND-ROADMAP.md](TECH-DEBT-AND-ROADMAP.md)** — a living, honest register of known limitations, deferred work and roadmap.
- **[RELEASE.md](RELEASE.md)** — the repeatable release-cut checklist.
- **[RELEASE-NOTES-0.7.0-DRAFT.md](RELEASE-NOTES-0.7.0-DRAFT.md)** — draft release notes for 0.7.0 (not yet tagged/published).
- **[EXPLORATION.md](EXPLORATION.md)** — *(Beta)* snapshots → trends, the What-If sandbox, and cross-system dependency links by hash.
- **[TIME-TRAVEL.md](TIME-TRAVEL.md)** — *(Experimental)* opt-in, out-of-warranty historical replay against a logging server you own.

## Audit findings (quality & stress passes)

Point-in-time reviews with concrete findings, run against this codebase.

- **[CLEAN-CODE-AUDIT.md](CLEAN-CODE-AUDIT.md)** — a whole-codebase clean-code review (519 files, 67 findings, zero correctness/security defects).
- **[PERF-PATTERNS-REVIEW.md](PERF-PATTERNS-REVIEW.md)** — a speed/responsiveness/design-patterns review at the 60-programme/200-project scale target.
- **[RESILIENCE-FINDINGS.md](RESILIENCE-FINDINGS.md)** — a messy-data stress pass over every report/derivation/screen, and the hardening fixes.
- **[LOGIC-FINDINGS.md](LOGIC-FINDINGS.md)** — a logic & collision audit (identity collisions, unstable sorts) across every report/widget/screen/view.
- **[BUNDLED-BACKENDS-STRESS.md](BUNDLED-BACKENDS-STRESS.md)** — a stress pass over every bundled backend/broker definition in the catalogue.
- **[I18N-COVERAGE.md](I18N-COVERAGE.md)** — the localisation coverage audit for the i18n dictionary (en/fr/de/es).

---

**Not a doc but worth knowing about:** the importable n8n reference workflows live in
**[artifacts/n8n-blueprints/](../artifacts/n8n-blueprints/README.md)**, and the
top-level **[README](../README.md)**, **[LICENSING.md](../LICENSING.md)**,
**[CHANGELOG.md](../CHANGELOG.md)**, **[SECURITY.md](../SECURITY.md)** and
**[AGENTS.md](../AGENTS.md)** cover install/use, the open-core model, release
history, vulnerability disclosure, and contributor/agent notes respectively.
