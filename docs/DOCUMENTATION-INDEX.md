# Documentation index

A map of every current document in `docs/`, grouped by what it's for and who it's for. This page
doesn't duplicate content — each entry is one line; follow the link for the real thing. Start with
**[TECHNICAL.md](TECHNICAL.md)** if you just want the single technical reference; use this page when
you need something more specific (a runbook, a connector note, a design record).

For the install/deploy/use guide and the three audience "doors" (small teams & charities /
enterprises / engineers), see the **[README](../README.md)**. Superseded and point-in-time documents
live under **[archive/](archive/README.md)** and are not maintained.

---

## Architecture & internals

How the system is put together, the broker seam, and the extensibility model.

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — the system overview: stateless / zero-at-rest model, the layer cake, the broker seam, the security spine, dev-mode gating (Mermaid diagrams).
- **[DESIGN-PRINCIPLES.md](DESIGN-PRINCIPLES.md)** — the *why* behind the architecture: the small set of principles everything follows from (zero-at-rest, JSON-as-data, choke points, composition, scope layering, tiered auth, separation of accounts), with operational implications for people who run it.
- **[DESIGN-PRINCIPLES-AGENTS.md](DESIGN-PRINCIPLES-AGENTS.md)** — the same principles as terse, directive invariants (RULE / CHECK / FIX) for AI agents editing the repo.
- **[TECHNICAL.md](TECHNICAL.md)** — the single consolidated technical reference.
- **[SEQUENCES.md](SEQUENCES.md)** — traced sequence walkthroughs (auth, broker read, optimistic-concurrency write, capability resolution, snapshot sign/verify, notification dispatch, dev-mode gating).
- **[READING-GUIDE.md](READING-GUIDE.md)** — subsystem → entry-point-file map, plus a glossary of the domain vocabulary.
- **[FUNCTION-MAP.md](FUNCTION-MAP.md)** — the generated per-function index of every source file (CI-drift-guarded).
- **[BROKER.md](BROKER.md)** — the `Broker` interface seam and its invariants (why the codebase can't know the broker is n8n).
- **[BROKER-HTTP-BINDING.md](BROKER-HTTP-BINDING.md)** — the reference HTTP wire protocol a contract-speaking broker implements.
- **[CONTRACT.md](CONTRACT.md)** — the published, versioned `Broker` contract (request/response shapes, control semantics), generated from source.
- **[API-REFERENCE.md](API-REFERENCE.md)** — the complete northbound HTTP API surface (every route, method, `/api` path, auth/RBAC gate), generated from the route source and CI-drift-guarded.
- **[INTEGRATION-PLANES.md](INTEGRATION-PLANES.md)** — the seven integration planes (backends, brokers, outputs, notifications, methodologies, reports, screens) and the shared catalogue.
- **[COMPOSITION-TIER.md](COMPOSITION-TIER.md)** — the composition seam and store-adapter roles (authoritative ▸ augmenting ▸ cache) that let a self-host DB and backends coexist.
- **[METHODOLOGIES.md](METHODOLOGIES.md)** — the methodology views (Kanban, Scrum, Gantt, PRINCE2, RAID, list) and how to add your own.
- **[FEATURE-MODULES.md](FEATURE-MODULES.md)** — optional, lazily-loaded backend modules an operator can switch off.
- **[FEATURE-GOVERNANCE.md](FEATURE-GOVERNANCE.md)** — how features/methodologies/reports are gated across org → programme → project.
- **[DATA-REQUIREMENTS.md](DATA-REQUIREMENTS.md)** — what each view/report needs from the backend, and how it degrades when the data isn't there.
- **[FIELD-CATALOGUE.md](FIELD-CATALOGUE.md)** — the cross-product field superset used to extend the canonical field registry.
- **[PPM-DEPTH.md](PPM-DEPTH.md)** — the depth modules closing the gap to best-in-class PPM (portfolio optimiser, OKR cascade, skills demand/capacity, timesheets + staff-cost, stage-gate, SAFe PI board).
- **[SELF-HOST-DB.md](SELF-HOST-DB.md)** — the optional, customer-owned stateful database for greenfield teams with nothing to connect.
- **[RETENTION.md](RETENTION.md)** — durable time-series history (journal → snapshot → trend) and its cloud connectors (S3/DynamoDB/BigQuery via the retention-broker).
- **[N8N-WORKFLOWS.md](N8N-WORKFLOWS.md)** — generate, wire & verify n8n workflows; open vs. licensed prebuilt integrations.
- **[MCP.md](MCP.md)** — the read-only (write opt-in) MCP server so an AI agent can read through the broker seam.
- **[adr/0001-broker-boundary.md](adr/0001-broker-boundary.md)** — ADR: the broker boundary decision.
- **[adr/0002-language-choice.md](adr/0002-language-choice.md)** — ADR: the implementation-language decision.
- **[PARKED-DECISIONS.md](PARKED-DECISIONS.md)** — items surfaced by review that need a maintainer decision before building, with the recommended call for each.

### Connectors (vendor notes)

Capability-honest notes on each catalogued connector — what's mapped and what's not yet live-tenant-verified.

- **[vendors/ORACLE-FUSION-ERP.md](vendors/ORACLE-FUSION-ERP.md)** — Oracle Fusion Cloud ERP (Project Financial Management).
- **[vendors/NETSUITE.md](vendors/NETSUITE.md)** — Oracle NetSuite.
- **[vendors/SAP-S4HANA-PS-PPM.md](vendors/SAP-S4HANA-PS-PPM.md)** — SAP S/4HANA (PS/PPM) financials, read-only.
- **[vendors/DYNAMICS-365-FO.md](vendors/DYNAMICS-365-FO.md)** — Dynamics 365 Finance & Operations (Project Management and Accounting).

### Contributor plane guides

Short how-tos for extending each integration plane (`docs/dev/`).

- **[dev/PLANE-BACKENDS.md](dev/PLANE-BACKENDS.md)**, **[dev/PLANE-BROKERS.md](dev/PLANE-BROKERS.md)**, **[dev/PLANE-OUTPUTS.md](dev/PLANE-OUTPUTS.md)**, **[dev/PLANE-NOTIFICATIONS.md](dev/PLANE-NOTIFICATIONS.md)**, **[dev/PLANE-METHODOLOGIES.md](dev/PLANE-METHODOLOGIES.md)**, **[dev/PLANE-REPORTS.md](dev/PLANE-REPORTS.md)**, **[dev/PLANE-SCREENS.md](dev/PLANE-SCREENS.md)** — one per plane.

## Security & compliance

Controls, audits, and the frameworks they map to.

- **[SECURITY-AUDIT.md](SECURITY-AUDIT.md)** — the consolidated security posture: every control, where it's implemented, and residual risk.
- **[AI-SECURITY.md](AI-SECURITY.md)** — the end-to-end AI control model: what's gated, contained, and the residual boundaries.
- **[THREAT-MODEL.md](THREAT-MODEL.md)** — a STRIDE threat model and trust boundaries, for security review and pen-test scoping.
- **[COMPLIANCE.md](COMPLIANCE.md)** — control mapping to SOC 2, ISO/IEC 27001:2022 and NIST CSF 2.0.
- **[CONTROL-EVIDENCE.md](CONTROL-EVIDENCE.md)** — the auditor evidence index: each control mapped to the exact code that implements it and the test/command that proves it.
- **[SECURITY-QUESTIONNAIRE.md](SECURITY-QUESTIONNAIRE.md)** — a pre-filled vendor-security questionnaire (CAIQ / SIG Lite / VSA), each row question → answer → evidence pointer.
- **[AUTH-PROVENANCE.md](AUTH-PROVENANCE.md)** — each auth crypto primitive mapped to its backing library (openid-client / jose / node-saml / Node crypto), with the one deliberate exception recorded.
- **[PRIVACY.md](PRIVACY.md)** — controller/processor position, GDPR Article 30 records of processing, and the DPA position.
- **[SUPPLY-CHAIN.md](SUPPLY-CHAIN.md)** — SBOM generation, dependency advisories, and open supply-chain items.
- **[DATA-RESIDENCY.md](DATA-RESIDENCY.md)** — the fail-closed per-region routing control for the broker egress hop.
- **[SSO-SCIM.md](SSO-SCIM.md)** — the SAML 2.0 SSO + SCIM 2.0 provisioning/deprovisioning runbook, with Okta/Entra/Google Workspace examples.
- **[ACCESSIBILITY-CONFORMANCE.md](ACCESSIBILITY-CONFORMANCE.md)** — the WCAG 2.1 AA conformance report (VPAT-style), procurement-facing.
- **[ACCESSIBILITY-AUDIT.md](ACCESSIBILITY-AUDIT.md)** — the active WCAG 2.2 AA audit: the 14 defects found and fixed, the axe-core regression gate, and the residual/manual items.
- **[ops/EGRESS-INVENTORY.md](ops/EGRESS-INVENTORY.md)** — every outbound destination the gateway can reach.
- **[ops/ROLES.md](ops/ROLES.md)** — the RBAC model (base ladder + PMO/admin authorities) in product terms.

## Operations & scale

Running it in production.

- **[OPERATIONS.md](OPERATIONS.md)** — scaling, high availability, disaster recovery & backup, and enabling OTLP telemetry.
- **[SCALING.md](SCALING.md)** — how OmniProject stays fast and gentle on backend rate limits as usage grows; companion to `ops/MULTI-REPLICA.md`.
- **[ENTERPRISE-OPS.md](ENTERPRISE-OPS.md)** — the data map, DSAR, retention and backup/DR answers procurement asks for.
- **[QUICKSTART.md](QUICKSTART.md)** — clone to your own real data (read-only) in about 15 minutes; the fast on-ramp.
- **[DEPLOY-LOCAL.md](DEPLOY-LOCAL.md)** — the standalone stack (bundled Authentik IdP, Traefik, local-CA TLS) for fastest evaluation.
- **[CLOUD-HOSTING.md](CLOUD-HOSTING.md)** — hosting on the managed clouds (GKE/AKS/EKS) and the retention/connector options.
- **[ops/RAILWAY-DEPLOY.md](ops/RAILWAY-DEPLOY.md)** — a hosted instance with no Docker host of your own.
- **[REVERSE-PROXY.md](REVERSE-PROXY.md)** — putting `omni-shell` behind an existing Traefik / Caddy / nginx.
- **[ops/MULTI-REPLICA.md](ops/MULTI-REPLICA.md)** — running multiple gateway replicas.
- **[ops/SETUP-WIZARD.md](ops/SETUP-WIZARD.md)** — the guided first-run setup.
- **[ops/DATABASE-BACKENDS.md](ops/DATABASE-BACKENDS.md)** — the supported self-host database backends.
- **[ops/BUSINESS-RULES.md](ops/BUSINESS-RULES.md)** — operator-configurable business rules.
- **[ops/IMPORT.md](ops/IMPORT.md)** — importing existing data.
- **[ops/RAW-API.md](ops/RAW-API.md)** — the raw API surface for scripting/integration.
- **[ops/LOAD-HARNESS.md](ops/LOAD-HARNESS.md)** — the load-test harness.
- **[ops/BENCHMARKS.md](ops/BENCHMARKS.md)** — the compute benchmarks (per-function derivation cost, no network).
- **[ops/PILOT-READINESS.md](ops/PILOT-READINESS.md)** — the pilot go-live readiness checklist.
- **[ops/SLO.md](ops/SLO.md)** — the service-level objectives and alerting baseline.
- **[ops/INCIDENT-RESPONSE.md](ops/INCIDENT-RESPONSE.md)** — the admin-impersonation / break-glass incident runbook.

## Product & buyer

Fit, maturity, and evaluation.

- **[ENTERPRISE-READINESS.md](ENTERPRISE-READINESS.md)** — the buyer-panel gap analysis (CEO, Finance, Compliance, CISO, IT, Projects).
- **[ENTERPRISE-GA-CHECKLIST.md](ENTERPRISE-GA-CHECKLIST.md)** — the enterprise go/no-go tracker: the deciding artifacts (verified connector, SOC 2, published scale run, lighthouse pilot) that flip "impressive" to "yes", with acceptance evidence.
- **[POV-SUCCESS-CRITERIA.md](POV-SUCCESS-CRITERIA.md)** — the time-boxed Proof-of-Value plan: entry gates, measurable success criteria, and the five go/no-go gates.
- **[SMALL-ORG-GUIDE.md](SMALL-ORG-GUIDE.md)** — the non-technical walkthrough for small teams, charities and self-hosters.
- **[SAFE-FIRST-RUN.md](SAFE-FIRST-RUN.md)** — the step-by-step path to evaluating against real data safely (dry-run, read-only first).
- **[FEATURE-MATURITY.md](FEATURE-MATURITY.md)** — a feature-by-feature maturity read: stable / beta / prototype / nominal, plus the buried debt.
- **[TESTING.md](TESTING.md)** — the test pillars and the CI coverage gates.
- **[MUTATION-TESTING.md](MUTATION-TESTING.md)** — StrykerJS mutation testing over the financial-derivation core: what's mutated, the score thresholds, and the weekly CI job.
- **[TECH-DEBT-AND-ROADMAP.md](TECH-DEBT-AND-ROADMAP.md)** — a living, honest register of known limitations, deferred work and roadmap.
- **[RELEASE.md](RELEASE.md)** — the repeatable release-cut checklist.
- **[launch/LAUNCH.md](launch/LAUNCH.md)** — the launch plan and checklist.
- **[launch/DEMO-SCRIPT.md](launch/DEMO-SCRIPT.md)** — the guided demo script.
- **[EXPLORATION.md](EXPLORATION.md)** — *(Beta)* snapshots → trends, the What-If sandbox, and cross-system dependency links by hash.
- **[TIME-TRAVEL.md](TIME-TRAVEL.md)** — *(Experimental)* opt-in, out-of-warranty historical replay against a logging server you own.

---

**Not a doc but worth knowing about:** the importable n8n reference workflows live in
**[artifacts/n8n-blueprints/](../artifacts/n8n-blueprints/README.md)**, and the
top-level **[README](../README.md)**, **[LICENSING.md](../LICENSING.md)**,
**[CHANGELOG.md](../CHANGELOG.md)**, **[SECURITY.md](../SECURITY.md)** and
**[AGENTS.md](../AGENTS.md)** cover install/use, the open-core model, release
history, vulnerability disclosure, and contributor/agent notes respectively.

**Archived documents** (point-in-time reviews, historical RFCs, superseded release notes) are under
**[archive/](archive/README.md)**.
