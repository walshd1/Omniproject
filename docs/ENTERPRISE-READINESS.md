# Enterprise readiness — a buyer-panel gap analysis

> **Audience:** a large multinational currently standardised on Jira, chartered to
> **improve delivery quality** while **reducing cost and time-to-report**.
> **Purpose:** give the evaluation panel — Head of IT, Head of Projects, Head of
> Compliance, Head of Finance, CISO, and CEO — a per-seat, evidence-grounded view of
> what OmniProject **already delivers today** (every claim cited to a real file in
> this repository) and the **concrete gaps** to close so the choice is unanimous.

This document is deliberately honest. Where a capability is partial, opt-in, or
sample-grade, it says so. Nothing here is aspirational marketing: each
"already delivered" line points at code, a contract, or a shipped document you can
open and read.

---

## 1. Executive summary

OmniProject is a **stateless, zero-at-rest, broker-agnostic overlay** for programme
and project management. Its architecture pre-answers the two objections that sink
most PPM evaluations before a feature is ever discussed:

**"We are not ripping out Jira."**
You don't. OmniProject **stores nothing** — it has no project database. There is no
first-party ORM/schema package at all (an earlier empty scaffold was removed
outright), because there are no tables to fill: every read and write is brokered
**live** to the system that already owns the data, through one swappable seam
(`docs/BROKER.md`, `docs/CONTRACT.md`). Jira stays the single source
of truth; OmniProject is a different **view** onto it. There is no migration, no
copy to keep in sync, and no drift to fix. A backend catalogue
(`lib/backend-catalogue/`) already models many vendors, so adding OpenProject, SAP,
or ServiceNow underneath is federation, not a re-platform.

**"We are not adding another breach surface."**
Because nothing is at rest, the blast radius is structurally smaller than any tool
that copies your issues into its own store. There is no project-data database to
encrypt, back up, reside, or subpoena. The only boundary data crosses is the
outbound broker hop — and that hop is where security and data-residency **can be**
enforced (`docs/DATA-RESIDENCY.md`, fail-closed with HTTP 451 when a residency policy
is configured; opt-in, off by default). The controls a CISO expects are in the code:
OIDC + PKCE, RBAC, CSRF double-submit, HMAC-signed webhooks, step-up re-auth, and
AES-256-GCM sealing are on by default; the higher-assurance controls — data-residency
enforcement, a persisted tamper-evident audit hash-chain, and Ed25519-signed
provably-immutable snapshots — ship in the code but are **opt-in** (enable them via the
enterprise/hardened profile; see the roadmap in §4 and `docs/ENTERPRISE-OPS.md`).

**The headline cost/quality story.**
- **Cost:** Apache-2.0 core, self-hostable, **no per-seat licence**, **no migration
  project**. The recurring PPM seat spend and the one-off data-migration line both
  go to zero. (See the TCO/ROI sketch in §3.)
- **Time:** the executive board pack, portfolio RAG, EVM, benefits realisation and
  multi-currency consolidation are **generated from live backend data** on demand —
  replacing the monthly manual spreadsheet-and-slides cycle that PMOs run by hand.
- **Quality:** the "messy data" and provenance layers surface data-quality problems
  and show, per field, exactly which backend a number came from — so the board is
  arguing about decisions, not about whose spreadsheet is right.

The rest of this document takes each panel seat in turn.

---

## 2. Per-seat analysis

### 2.1 CEO — "Does this de-risk the decision and show me the portfolio?"

**Cares about:** a single, trustworthy portfolio view; a defensible, low-risk buy;
a clear cost and quality narrative to the board; no big-bang change programme.

**Already delivered (verified):**
- **Executive board pack** — one consolidated, board-ready view (headline
  narrative, RAG spread, consolidated financials in one reporting currency, and the
  exceptions needing a board decision): `artifacts/omniproject/src/components/reports/ExecBoardPack.tsx`,
  derivation in `artifacts/omniproject/src/lib/exec-pack.ts`.
- **Scheduled executive digest** — a periodic, read-only portfolio roll-up pushed
  over the existing notification seam (email/Slack/Teams) so execs who never open
  the app still get the Monday summary; aggregates only, never project detail:
  `artifacts/api-server/src/lib/exec-digest.ts`.
- **Benefits realisation** — planned vs realised benefit value across projects,
  consolidated and grouped by programme (worst realisation first):
  `artifacts/omniproject/src/components/reports/BenefitsRealisationRollup.tsx`.
- **Low-risk architecture** — no migration, no lock-in: the overlay reads live from
  whatever you already run (`README.md`, `docs/BROKER.md`).

**Gaps to add:**
- **Strategy → delivery traceability** — link corporate objectives/OKRs down to the
  programmes and projects that deliver them, so the board pack answers "which
  investments move which goal." (Cross-programme roadmap exists; the objective
  linkage does not.)
- **ROI/TCO model artefact** — a shipped, parameterised model (seats × PPM list
  price + migration + admin FTE) the CEO can put in front of the board (see §3).

### 2.2 Head of Finance — "Can I trust the numbers and consolidate across currencies?"

**Cares about:** accurate consolidated financials; multi-currency portfolios;
CapEx/OpEx split for accounting treatment; earned-value discipline; auditable figures.

**Already delivered (verified):**
- **EVM** — programme roll-up computes earned value and CPI when every contributing
  project reports it, and honestly returns `null` (rather than a misleading number)
  when it doesn't: `artifacts/api-server/src/lib/programmes.ts` (`earnedValue`,
  `cpi`, per-project reporting counts). Full PV/EV/AC/CPI/SPI/EAC/ETC/BAC report
  definition in `lib/backend-catalogue/assets/reports/evm.json`; chart in
  `artifacts/omniproject/src/components/reports/FinancialEvmChart.tsx`.
- **CapEx/OpEx** — expenditure-type split with depreciation/annual-charge derivation
  and category roll-ups: `artifacts/omniproject/src/lib/capex.ts`,
  `artifacts/omniproject/src/components/reports/CapexOpex.tsx`.
- **Reporting currency + FX** — each project's budget/actual/forecast is converted
  into **one reporting currency** and rolled up; conversion is pure and unit-tested
  (`artifacts/api-server/src/lib/currency.ts`, `convertAmount`). Rates are read
  **through the broker** from the backend/ERP (`getFxRates`), so nothing is stored.
- **Benefits value** in money terms, consolidated by programme (as above).

**Honesty note:** the shipped FX table (`artifacts/api-server/src/lib/fx-fallback.ts`)
is **indicative sample data only** — GBP-based, `provenance: "sample"`, epoch
`asOf`. It is a fallback so demos and offline runs don't break; it is **not** a live
market feed.

**Gaps to add:**
- **Multi-currency consolidation from a live/audited FX source** — wire the FX read
  to a real ERP/market feed (e.g. the finance system's month-end rate table) with a
  dated provenance stamp, so consolidated figures are audit-defensible, not
  indicative.
- **ERP/finance backend for actuals** — a first-class finance backend adapter so
  actuals/committed spend come from the book of record, not just the PM tool.

### 2.3 Head of Compliance — "Can I prove control, evidence, and segregation of duties?"

**Cares about:** demonstrable governance; segregation of duties and approvals; an
evidence pack for auditors; data-residency; a defensible record of who changed what.

**Already delivered (verified):**
- **Governance / feature-gating hierarchy (org → programme → project)** — monotonic
  narrowing with soft (enable/disable) and hard (require/forbid, locked) mandates,
  enforced server-side, with every mutation semantically audited
  (`docs/FEATURE-GOVERNANCE.md`; UI `artifacts/omniproject/src/components/settings/FeatureGovernance.tsx`;
  see also the CHANGELOG `[Unreleased]` governance-authorization hardening).
- **Segregation of duties / four-eyes approvals** — maker-checker: sensitive actions
  require a proposer plus a *different* approving admin
  (`artifacts/api-server/src/lib/dual-control.ts`). Business-governance (`pmo`) and
  technical-admin (`admin`) are **orthogonal roles** by design — "different jobs"
  (`docs/ops/ROLES.md`).
- **Tamper-evident audit** — append-only keyed hash-chain: each link is
  `HMAC(auditKey, seq | prevHash | canonical(event))`, so removing or reordering any
  event breaks every later link (WORM-style): `artifacts/api-server/src/lib/audit-chain.ts`;
  structured audit with redaction + external NDJSON sink in
  `artifacts/api-server/src/lib/audit.ts`. **Note:** external delivery is
  best-effort/in-memory-buffered and the chain head persists across restarts only when
  `AUDIT_CHAIN_FILE` (or shared KV) is set — configure a durable sink for an
  auditor-grade trail (on the enterprise hardening checklist).
- **Provably-immutable signed snapshots** — freeze a report/board pack, SHA-256 the
  canonicalised content, and sign the manifest with the deployment's Ed25519 key so
  anyone with the public key can verify it **offline**, no server round-trip:
  `artifacts/api-server/src/lib/snapshot.ts`, `artifacts/api-server/src/lib/signing.ts`,
  `artifacts/api-server/src/lib/provenance.ts`. Snapshot signing is **opt-in** (enable it
  in the enterprise/hardened profile; unsigned snapshots are still content-hashed).
- **Data residency** — fail-closed region routing at the single outbound hop:
  undeclared-region or out-of-region endpoints refused with HTTP 451 and an audit event.
  **Opt-in and off by default** — inert until a `DATA_RESIDENCY_*` policy is configured,
  and enforces a single region today (per-country/multi-region is roadmap #2):
  `docs/DATA-RESIDENCY.md`.
- **Control mapping** — SOC 2 / ISO 27001:2022 / NIST CSF 2.0 self-assessment
  matrix: `docs/COMPLIANCE.md`. DSAR support: `artifacts/api-server/src/lib/dsar.ts`.

**Gaps to add:**
- **One-click compliance/evidence pack** — bundle the audit-chain segment, snapshot
  manifests, governance state, and control matrix into a single exportable,
  signed evidence pack for an auditor, per scope/period.
- **Phase-3 RACI + risk register at the governance layer** — a RAID log exists per
  project; add a portfolio-level RACI and programme risk register wired to the
  governance hierarchy.
- **Independent attestation** — SOC 2 Type II / ISO 27001 certification is a control
  *mapping* today, not an audited certificate; the pen-test summary is likewise a gap.

### 2.4 CISO — "What's the attack surface, and is the security posture credible?"

**Cares about:** minimal blast radius; strong authN/authZ; secrets handling;
supply-chain integrity; SSO/lifecycle integration; observability of security events.

**Already delivered (verified):**
- **Structurally small blast radius** — zero project data at rest (no first-party
  datastore or ORM package at all); the overlay holds no copy to steal.
- **OIDC + PKCE** with JWKS verification and SSRF guards on issuer-supplied
  `jwks_uri` (`artifacts/api-server/src/lib/oidc.ts`, `.../jwks.ts`).
- **RBAC** — viewer/contributor/manager + orthogonal admin/pmo, mapped from IdP
  claims (`docs/ops/ROLES.md`, `SECURITY.md`).
- **CSRF** — Origin/Referer + double-submit token (`artifacts/api-server/src/lib/csrf.ts`).
- **HMAC** — SHA-256 signatures on webhooks/broker messages
  (`artifacts/api-server/src/lib/webhooks.ts`, `docs/CONTRACT.md`).
- **Step-up re-auth** for highest-risk actions (`artifacts/api-server/src/lib/step-up.ts`).
- **AES-256-GCM** sealing for sessions, config, and vault secrets
  (`artifacts/api-server/src/lib/crypto-aes-gcm.ts`, `.../session-crypto.ts`);
  KMS + cloud vault integration (`kms.ts`, `vault-aws.ts`, `vault-azure.ts`).
- **SSO / lifecycle** — SAML 2.0 SP (`artifacts/api-server/src/lib/saml.ts`) and
  SCIM 2.0 provisioning/deprovisioning (`artifacts/api-server/src/lib/scim.ts`).
- **Supply chain** — CycloneDX + licence SBOM in CI, `pnpm audit` gate on CRITICAL,
  Dependabot, pinned base image, `--frozen-lockfile`; plus a `minimumReleaseAge`
  quarantine in `pnpm-workspace.yaml` (`docs/SUPPLY-CHAIN.md`).
- **Distributed tracing** — W3C Trace Context + a minimal OTLP/HTTP exporter that
  ships spans to any OTLP collector (Datadog/Jaeger/Honeycomb/Tempo) when
  `OTEL_EXPORTER_OTLP_ENDPOINT` is set: `artifacts/api-server/src/lib/tracing.ts`.

**Honesty notes:** SAML is a **runtime-optional** dependency (not installed by a
default `pnpm install`; enabled by adding `@node-saml/node-saml` when `SAML_*` is
configured). Tracing is trace-context + span export, not a full metrics/logs OTel
SDK. Image signing / SLSA provenance is **parked** in `docs/SUPPLY-CHAIN.md`.

**Gaps to add:**
- **SSO/SAML + SCIM as first-class, always-present** (bundle SAML by default; publish
  an SSO/SCIM setup runbook and IdP presets beyond the existing `idp-presets`).
- **SBOM + SLSA provenance + signed images**, plus an independent **pen-test
  summary** to attach to the security questionnaire.
- **Full observability** — metrics + log correlation (OpenTelemetry SDK), shipped
  dashboards, and security-event alerting.

### 2.5 Head of IT — "How does it deploy, scale, and stay up in my estate?"

**Cares about:** fits the existing platform (K8s, IdP, reverse proxy); HA/DR;
scale headroom; operational runbooks; low run cost.

**Already delivered (verified):**
- **Runs where you do** — single Docker host up to Kubernetes; compose profiles for
  standalone, enterprise (BYO-SSO), and load-test; a hardened K8s manifest
  (`k8s-enterprise-manifest.yaml`) with non-root, read-only rootfs, dropped caps,
  probes, and no auto-mounted service-account token.
- **Fits your identity + edge** — BYO SSO (OIDC/SAML/SCIM); reverse-proxy guide
  (`docs/REVERSE-PROXY.md`) for Traefik/Caddy/nginx.
- **HA posture** — stateless replicas share rate-limit counters and the
  broker-log/notification SSE bus via Redis when `REDIS_URL` is set; **presence
  is currently per-replica only** (connections live on one replica — see the
  "Multi-replica note" in `artifacts/api-server/src/lib/presence-hub.ts`). DR is
  "container start + config mount," with no data to rehydrate because the
  backends are the source of truth (`docs/ENTERPRISE-OPS.md`).
- **Scale mechanisms** — single-flight read coalescing, optional latency-aware TTL
  cache, list virtualisation, abortable fan-outs, tunable rate limiting
  (`docs/SCALING.md`), plus a load-test rig (`docker-compose.loadtest.yml`).
- **Tracing hooks** already present (§2.4).
- **Helm chart + enterprise profile** — a first-class chart
  (`deploy/helm/omniproject/`) with templates for HPA, PDB, NetworkPolicy,
  persistence and OTLP, plus an opinionated `values-enterprise.yaml` that turns on
  HA (replicas 3 / HPA / PDB / anti-affinity), default-deny network policy, OTLP
  export, Redis-shared fleet state, data-residency and snapshot signing — while
  keeping the gateway zero-at-rest (external vault/KMS + Redis, no config PVC).
- **Observability baseline** — Prometheus alert + SLO recording rules
  (`deploy/monitoring/prometheus-rules.yaml`), a RED Grafana dashboard
  (`deploy/monitoring/grafana-dashboard.json`), and reference SLOs with an
  error-budget (`docs/ops/SLO.md`); OTLP span+metric export via the enterprise
  profile.

**Gaps to add:**
- **Scale validation at target size** — a published result for **~60 programmes /
  200 projects** (latency, throughput, resource envelope), not just the harness.
- **Broker HA in the sample manifest** — `k8s-enterprise-manifest.yaml` still ships
  the n8n broker on single-replica SQLite (with an in-file warning + the Postgres
  queue-mode migration path); move it to n8n queue-mode on managed Postgres + Redis
  for a true-HA reference.
- **Tested multi-region DR runbook** — a rehearsed multi-region DR playbook beyond
  "container start + config mount."

### 2.6 Head of Projects — "Will overworked PMs actually use it, and does it fit our methods?"

**Cares about:** methodology fit; low change-management burden; resource/capacity
visibility; cross-programme dependencies; a genuinely lighter PM experience.

**Already delivered (verified):**
- **Methodology packs** — the same backend renders as Kanban, Scrum (backlog/
  burndown/velocity), Gantt/Waterfall, PRINCE2 stages, RAID, or list — data-only
  packs, no per-method runtime code (`docs/METHODOLOGIES.md`;
  `lib/backend-catalogue/assets/methodologies/*.json`, incl. SAFe/Scrumban and
  charity/SME sector packs).
- **Capacity & resource management** — utilisation heatmap, over-allocation flags,
  and a programme/portfolio capacity roll-up
  (`artifacts/omniproject/src/components/reports/ResourceHeatmap.tsx`,
  `.../CapacityRollup.tsx`); plus **capacity actuals vs plan** (logged hours vs
  allocation) added in CHANGELOG `[Unreleased]`.
- **Cross-programme dependency map + RAID** — dependency links by hash fingerprint
  and a portfolio roadmap derived on the fly
  (`artifacts/omniproject/src/components/reports/DependencyLinks.tsx`,
  `.../PortfolioRoadmap.tsx`, `.../RaidRegister.tsx`).
- **Experience layer for busy PMs** — a **My Work / Inbox** view aggregating a
  user's assigned items across every project plus their live notifications
  (`artifacts/omniproject/src/pages/MyWork.tsx`); a **command palette**; the exec
  **digest** so leaders don't chase; and a **messy-data** surface + **data
  provenance** badges so PMs trust what they see
  (`artifacts/omniproject/src/components/MessyDataControl.tsx`,
  `.../DataProvenance.tsx`).
- **Accessibility** — WCAG 2.1 AA self-assessment with a CI axe-core gate and a
  per-user overlay (text size, contrast, reduced motion, switch access, dictation):
  `docs/ACCESSIBILITY-CONFORMANCE.md`,
  `artifacts/omniproject/src/components/settings/A11yControls.tsx`.
- **SME/charity fit** — deployment profiles (nonprofit gets premium features free,
  enforcement off) and sector starter packs: `docs/SMALL-ORG-GUIDE.md`.

**Gaps to add:**
- **Persona dashboards + progressive disclosure** — role-shaped default landing
  views (PM / programme manager / exec) that hide advanced surfaces until needed.
  (Dashboard-widget infrastructure and a `MyWork` view exist; explicit
  persona-scoped progressive disclosure does not.)
- **Cross-programme resource levelling** — move from *seeing* over-allocation to
  *resolving* it (levelling suggestions across programmes).

---

## 3. The "easy choice" clinchers

### 3.1 "Keep Jira, sit on top"
The single strongest positioning: OmniProject is **not a system to adopt**, it's a
**layer over the system you already run**. No migration, no second store, no sync
drift — because there is no store (no first-party datastore or ORM package exists).
Jira stays authoritative; OmniProject renders programme rollups, portfolio RAG, and
the board pack as *views* of live Jira data through the broker seam. When the
multinational later federates SAP or ServiceNow underneath, the UI never changes.

### 3.2 The trust / quality story
Bad PPM decisions come from numbers nobody trusts. OmniProject attacks that directly:
- **Messy-data surfacing** flags the data-quality problems in the underlying tool
  (`MessyDataControl.tsx`) instead of silently averaging over them.
- **Provenance** shows, per field, which backend a value came from
  (`DataProvenance.tsx`, `artifacts/api-server/src/lib/provenance.ts`).
- **Collision / integrity audits** — the audit hash-chain and Ed25519-signed
  snapshots make a reported figure **provably unaltered** and reproducible later.
The board argues about the decision, not about whose export is correct.

### 3.3 TCO / ROI sketch vs enterprise PPM
Illustrative, to be parameterised with the buyer's real numbers (see §2.1 gap):

| Line item | Enterprise PPM (typical) | OmniProject |
| --- | --- | --- |
| Per-seat licence | £X/seat/month × thousands of seats | **£0** (Apache-2.0 core, self-host) |
| Data migration | one-off six/seven-figure project | **£0** (overlay; no migration) |
| Sync/integration upkeep | ongoing (copied data drifts) | **minimal** (no copy to sync) |
| PMO reporting effort | manual monthly pack | **auto-generated** board pack/digest |
| New breach surface | a new data store to secure/comply | **none at rest** |
| Infra run cost | vendor cloud | your K8s/Docker, stateless replicas |

The recurring seat spend and the migration line — usually the two biggest numbers in
a PPM business case — both go to zero, while the manual reporting cycle is replaced
by generated artefacts.

---

## 4. Enterprise-readiness roadmap

Effort: **S** ≈ days, **M** ≈ 1–3 weeks, **L** ≈ 1–2 months. "In backlog?" reflects
whether the item already appears in the code, `[Unreleased]` CHANGELOG, or
`docs/SUPPLY-CHAIN.md` / `docs/PARKED-DECISIONS.md` as parked/planned.

| # | Gap | Owning seat | Effort | Already in backlog? |
| --- | --- | --- | --- | --- |
| 1 | Multi-currency consolidation from a live/audited FX source (replace indicative table) | Finance | M | Partial — conversion + broker FX read exist; live feed does not |
| 2 | Per-country / multi-region data-residency consolidation (beyond single fail-closed region) | Compliance / IT | M | Partial — single-region enforcement shipped |
| 3 | Scale validation at ~60 programmes / 200 projects (published result) | IT | M | Partial — load-test harness exists, no published result |
| 4 | SSO/SAML bundled by default + SCIM setup runbook + IdP presets | CISO / IT | S–M | Partial — SAML/SCIM implemented; SAML runtime-optional |
| 5 | SBOM + SLSA provenance + signed images + pen-test summary | CISO | M | Partial — SBOM in CI; SLSA/signing parked |
| 6 | SOC 2 / ISO 27001 independent attestation (mapping → certified) | Compliance / CISO | L | Partial — control mapping exists (`docs/COMPLIANCE.md`) |
| 7 | One-click compliance/evidence pack (audit-chain + snapshots + governance) | Compliance | M | No — primitives exist, bundling does not |
| 8 | Segregation-of-duties / approvals coverage widened to more sensitive actions | Compliance | S | Partial — maker-checker engine (`dual-control.ts`) shipped |
| 9 | Phase-3 RACI + programme risk register at the governance layer | Compliance / Projects | M | Partial — per-project RAID exists |
| 10 | ERP/finance backend adapter for actuals (book of record) | Finance | L | No |
| 11 | Multi-region HA/DR runbook + true-HA broker in the sample manifest | IT | M | Partial — Helm chart + `values-enterprise.yaml`, OTLP export, and a Prometheus/Grafana/SLO baseline now ship; the broker in `k8s-enterprise-manifest.yaml` is still single-replica SQLite, and the DR playbook is single-region |
| 12 | ROI/TCO model artefact + strategy→delivery (OKR) traceability | CEO / Finance | M | No |
| 13 | Cross-programme resource levelling (resolve, not just see, over-allocation) | Projects | M | Partial — capacity roll-up + over-allocation flags exist |
| 14 | Persona dashboards + progressive disclosure | Projects | M | Partial — widgets + MyWork exist; persona scoping does not |

---

## 5. What to build first

Sequence by **panel-unlock per unit effort** — the cheapest items that flip the most
sceptical seats.

1. **SSO/SAML bundled by default + SCIM runbook (#4, S–M).** The CISO and IT can't
   approve without frictionless SSO and lifecycle deprovisioning. The code already
   exists; making SAML first-class (not opt-in) and shipping the runbook is a small
   change that removes the single most common enterprise blocker.
2. **Live/audited FX consolidation (#1, M).** Flips Head of Finance from "indicative
   only" to "audit-defensible." The conversion engine and broker FX read already
   exist; this is a data-source wiring job, not new machinery.
3. **Scale validation at target size (#3, M).** Turns Head of IT's "probably scales"
   into a published number for ~60 programmes / 200 projects — the harness is ready.
4. **One-click compliance/evidence pack (#7, M).** Converts Compliance's many strong
   primitives (audit-chain, signed snapshots, governance state) into the one artefact
   an auditor actually asks for.

**Highest single unlock:** **#4 (SSO/SAML default + SCIM)** — lowest effort, and it
converts the two hardest "no" votes (CISO, IT) into "yes." Do it first.
