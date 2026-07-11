# Changelog

All notable changes to OmniProject are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from 1.0.0.

## [Unreleased]

### Changed

- **Uniform boolean-env vocabulary (`isTruthy`).** ~8 modules hand-rolled their own truthy check for
  boolean env toggles with divergent accepted spellings (some `true` only, some `true`/`on`, one
  `1`/`true`/`on`/`yes`); they now share a single `isTruthy` helper (`lib/env-config`, matching the
  existing `envBool` vocabulary — `1`/`true`/`on`/`yes`, case-insensitive, trimmed). This uniformly
  **broadens** which spellings count as affirmative — e.g. `RATE_LIMIT_DISABLED=on` or
  `SAML_WANT_RESPONSE_SIGNED=yes` are now honoured where a stricter site previously ignored them. It
  only ever *adds* accepted spellings; the documented `true` behaves identically, so a canonical
  config is unaffected. This is the one user-visible change in the clean-code batch.
- **Behaviour-preserving Clean Code dedup.** No wire or behaviour change: `round2` hoisted to its
  documented home `lib/num.ts` (was redeclared in four finance modules); a shared `withBrokerErrors`
  wrapper replaces the `try/catch → log → respondBrokerError` block repeated across the broker-backed
  route handlers (each handler's log context preserved); `sendJson` (`lib/api`) adopted in seven SPA
  write-path modules that hand-rolled the same fetch; a `<GatedTextField>` component collapses the
  ~14× repeated show/label/`Input`/onChange block across the issue-dialog panels; `lib/tools.ts`
  renamed to `lib/capability-governance.ts` (it holds the capability-governance model served at
  `/api/governance`, and the old name collided with the unrelated `lib/capabilities.ts`); and a few
  zero-importer dead exports were removed. Statelessness and the broker seam are untouched.
- **SAML replay protection (Redis-gated, stateless-preserving).** When shared state is Redis-backed,
  the SAML SP now enables `validateInResponseTo` with a shared-cache-backed request-id store, binding
  each ACS response to a pending AuthnRequest and consuming it once (blocks unsolicited/replayed
  `SAMLResponse`s fleet-wide). Because that check fails closed, it is enabled ONLY with Redis — a
  stateless single-replica (or multi-replica-without-Redis) deployment keeps the always-on signature
  + `NotOnOrAfter` + audience checks and never risks breaking SP-initiated login. No domain data is
  stored; the request-id is ephemeral (8-min TTL) in the existing shared-state seam.
- **Rate-card identity hashing re-keyed to HKDF (one-time re-entry required).** The rate card's
  identity/title keyed hashes (`hashIdentity`) now derive their key via HKDF (`lib/crypto-keys`
  `deriveKey`, tag `rate-card:v2`) instead of a bare `SHA-256(master)`, matching the rest of the
  codebase. Because the rate-card store persists these hashes as its map keys, **existing rate-card
  data (rates, title labels, identity→role assignments) will no longer resolve after upgrading and
  must be re-entered once.** Pure hardening/consistency — the master key was already high-entropy;
  no security regression.
- **Broker contract is now self-contained (no dangling `$ref`s).** The generated broker contract
  referenced `Scope`, `ScopeLevel` (the forwarded per-principal data scope on `ActorContext`) and
  `SessionBind` (the per-session signing binding) without defining them, because their source lives in
  `lib/`. `gen-contract` now pulls those named types in via the same mechanism it already uses for
  `EnumeratedField`, so the contract schema (`docs/contract/broker.v1.schema.json`,
  `broker/contract.schema.generated.ts`, `docs/CONTRACT.md`) defines every type it references and the
  generator emits zero flags. Purely additive — no existing action or type shape changed.

- **Broker-neutral naming, extended to the backend catalogue.** The `guard-broker-isolation` CI
  check previously only scanned `artifacts/api-server/src` and `artifacts/omniproject/src`, so a
  shared/neutral type could still quietly carry a vendor-specific name in
  `lib/backend-catalogue/src` without CI catching it. Fixed the one instance that had (the
  `N8nBinding` interface — renamed to `BrokerBinding`; `BackendDefinition = BackendManifest &
  BrokerBinding`) and extended the guard to cover `lib/backend-catalogue/src` going forward, with an
  explicit allowlist for the two sanctioned exceptions: `n8n-generator.ts` (the concrete n8n
  blueprint generator — the equivalent of the adapter folder) and the neutral vendor-id enums
  (`BrokerKind`, `ActionMapping["kind"]`) whose job is literally to enumerate broker/transport
  identifiers, the same sanctioned shape as the JSON `id`/`kind` fields they mirror.
  `*.generated.ts` files are now skipped everywhere the guard scans — they're vendor JSON embedded
  verbatim, the same "data, not code" exception already carved out for the JSON itself.

### Fixed

- **Broker-isolation & compose CI guards had real blind spots — now closed and stricter.** The
  broker-isolation guard stripped comments with a naive `indexOf("//")`, which truncated string
  literals at the `//` in a URL — so a genuine vendor token in `"https://n8n.cloud"` was silently
  dropped before the naming scan (a false negative that let a leak pass CI); it also matched only
  static/`require` imports, missing a dynamic `import("./broker/reference-broker")`. Both seam
  guards (isolation, zero-at-rest) now share one string-literal-aware comment stripper and one
  `importSpecifier`, so neither can be quietly weaker than the other. Separately, the compose guard
  **failed open** — if the gateway service was renamed away from both known names, the production
  hardening checks (no-new-privileges, `cap_drop: [ALL]`, `read_only`) were silently skipped and the
  guard still passed; it now fails closed. Regression tests added for each. No product code changed —
  the guards that protect statelessness/the seam are simply harder to fool.
- **Generated contract/function-map tables no longer render broken.** `gen-contract` and
  `gen-function-map` emitted TypeScript types verbatim into Markdown table cells, so a union like
  `Promise<Issue | null>` or `op: "create" | "update" | "delete"` split the row into extra columns in
  the committed `docs/CONTRACT.md` / `docs/FUNCTION-MAP.md`; table cells are now pipe-escaped. A
  separate `leadingComment` bug let a file-header or section-divider comment bleed into the next
  export's one-line doc — breaking the comment run on a blank line corrected ~20 function rows in
  `FUNCTION-MAP.md`.
- **Portfolio finance rollup no longer silently mixes currencies.** `foldFinance` (the federated
  `GET /portfolio/summary` total) previously added a project's amount into the portfolio total *as-is*
  whenever an FX rate was missing — so a project reporting in an unrated currency (or any project when
  the FX fetch failed) corrupted the total by its exchange-rate factor (e.g. a ₩ amount summed straight
  into a GBP total). Unconvertible rows are now EXCLUDED from the total rather than mixed in, the
  section reports `null` (honestly "unavailable") instead of a misleading £0 when nothing folds, and any
  incompleteness (an unconvertible currency or a failed per-project financials call) is logged with the
  covered-vs-total project counts instead of being presented as a complete number. Same-currency rows
  still fold with no rate table needed, so a single-currency org is unaffected. Pure/stateless — no wire
  contract or broker-seam change.
- **Magic-link single-use is now race-free.** `consumeMagicToken` used a get-then-set with an `await`
  boundary between the check and the mark, so two concurrent redemptions of the same one-time link could
  both observe "unused" and both mint a session. It now claims the `jti` with an atomic compare-and-set
  (`sharedKv.cas`, the same shared-seam primitive `audit-chain` uses) — fleet-wide when Redis is
  configured, and inherently race-free on the stateless single-replica default.

### Security

- **Config + vault at-rest keys now derive via HKDF (non-breaking).** `config-crypto` and `vault-store`
  previously derived their at-rest master key with a bare `SHA-256(secret)`; both now use the shared
  HKDF `deriveKey` (domain-separated, salted) like the rest of the codebase. The migration is
  **versioned and non-breaking** — new writes use a new envelope prefix (`c2.` / `k2.`) while existing
  ciphertext (`c1.` / `k1.`) keeps decrypting via the legacy path, so **no re-key of on-disk config or
  vault data is required**; secrets migrate to the HKDF envelope on their next write. The copied
  master-secret fallback ladder is unified into one `masterSecret()` helper (each site keeps its exact
  order + dev default; `key-registry` deliberately keeps its own ordering so live signing material is
  untouched). A regression test seals a token with the old derivation and asserts it still opens.

- **Fleet-wide broker-HMAC replay defence (Redis-gated, stateless default unchanged).** Added
  `verifyBrokerRequestShared`: signature + freshness are identical to `verifyBrokerRequest`, but the
  nonce/replay check claims the nonce with an atomic compare-and-set in the shared-state seam when
  Redis is configured — so a replayed signed request routed to ANY broker replica is rejected
  fleet-wide, not just within the replica that first saw it. Without Redis it falls back to the
  in-process nonce cache, byte-identical to the synchronous verifier, so a stateless single-replica
  deployment is unchanged. Signature + freshness are verified BEFORE any shared-store I/O, so a bad or
  stale request never touches Redis. Same Redis-gated opt-in as session-registry / rate-limit / SAML
  replay; both broker-seam guards (isolation, zero-at-rest) still pass.

- **Real end-to-end RBAC enforcement is now under test.** Added `rbac-enforcement.test.ts`, which drives
  the live app OUT of demo auth (where every session holds all authorities) so the `requireRole` gates are
  genuinely exercised: it proves an admin-gated route admits admin and rejects member/pmo, a pmo-gated
  write admits pmo and rejects member/admin, and reads stay open — pinning down that `pmo` and `admin` are
  orthogonal authorities and that both require strong auth (WebAuthn `amr`). Closes the coverage gap where
  demo-mode made those route assertions tautological.
- **Compile-time drift guard on the settings allowlist.** `PATCH /settings` only persists keys in
  `ALLOWED_KEYS`, so a `SettingsState` field added to the interface/store but forgotten there was accepted,
  echoed back, and silently never written. A type-level exhaustiveness assertion now fails the build if any
  settings field is missing from the writable allowlist, closing that silent-persist-failure class.
- **Honest replay-scope note on the broker HMAC verifier.** Documented that the seen-nonce cache lives in
  the verifier's own process (per-broker-replica), so operators scaling the broker horizontally without a
  shared nonce store understand where replay defence is exact vs weakened — matching the honesty of the
  session-registry/rate-limit scope comments. No functional change to the synchronous, dependency-free
  seam verify contract.

### Added

- **Comments UI on the work item (SPA).** The `comments` backend module now has a front end: a
  `CommentsPanel` on the issue dialog (gated by the feature flag) that lists the thread and posts
  comments with `@mention` support — mentions surface in the recipient's notification bell via the
  existing SSE stream, no new wiring. Backed by `lib/comments` react-query hooks over the
  `/api/comments/:roomId` endpoint (room id `issue:<projectId>:<issueId>`).

- **Scheduled file-export delivery.** A new opt-in scheduled job renders a dataset (projects / issues /
  activity, `SCHEDULED_EXPORT_DATASET`) in a chosen format (`SCHEDULED_EXPORT_FORMAT` = csv/json/md/pdf)
  and **emails it as an attachment** to the configured `digestDelivery.emailRecipients`. Read-only and
  stateless-safe: it mints the same keyed, viewer-roled autonomous principal the digests use, reads the
  data DIRECTLY through the neutral broker seam (not the req-bound getters), renders via the shared
  `lib/export-datasets` serialisers, and delivers above the seam via SMTP. Off by default
  (`SCHEDULED_EXPORT_INTERVAL_HOURS=0`); a fleet drives `POST /api/admin/scheduled-export/run` from an
  external scheduler. A no-op unless SMTP + recipients are set. (`email.ts` gained attachment support;
  the export serialisers were extracted from the route into `lib/export-datasets` and are now shared.)

- **Helm chart hardening — NetworkPolicy, graceful shutdown, default HA spread.** The chart
  (`deploy/helm/omniproject`) gains an opt-in `NetworkPolicy` (targets only the gateway pods; DNS
  egress always allowed; tighten ingress source + strict egress via values) so the recommended Helm
  path matches the network segmentation the standalone manifest already had; a
  `terminationGracePeriodSeconds` (+ optional container `lifecycle`) so the SIGTERM handler can drain
  in-flight requests and SSE streams before SIGKILL; and a **default soft topology spread** across
  nodes (`kubernetes.io/hostname`, `ScheduleAnyway`) so losing one node can't take out every replica.
  The `helm-guard` CI test now asserts all three so they can't rot.

- **Comments & @mentions (new opt-in `comments` feature module).** Lightweight collaboration on a
  work item: a comment thread keyed by the same room-id convention presence uses
  (`issue:<projectId>:<issueId>` / `project:<projectId>`), with `@mention` parsing that dispatches a
  real-time notification (kind `mention`) to the mentioned user over the existing notify bus. Comments
  live in the **ephemeral shared-state seam** — in memory by default, fleet-wide when Redis is
  configured — so the zero-at-rest-above-the-seam rule holds (it's coordination state, not
  system-of-record data). Durability is an **opt-in write-through**: with `COMMENT_PERSISTENCE=backend`
  an issue-scoped comment is also written to the backend as a `note` TaskItem through the neutral
  broker seam (the store itself never imports a database or the broker). Default-off (reason:
  storage); reads are open to any authenticated user, posting requires `contributor`, deletion is the
  author or a PMO/admin. `GET/POST /api/comments/:roomId`, `DELETE /api/comments/:roomId/:commentId`.

- **Optional email delivery for the scheduled digests.** The proactive "what needs me" and executive
  digests can now also be emailed to a fixed, operator-configured recipient list (`digestDelivery.
  emailRecipients` in settings, or the `DIGEST_EMAIL_RECIPIENTS` env), IN ADDITION to the existing
  notify-bus dispatch — for operators who don't route notifications through their broker. It's an
  above-the-seam SMTP delivery channel (like any egress, not persistence, so the zero-at-rest rule is
  untouched), best-effort and a strict no-op unless SMTP is configured AND at least one recipient is
  set. A skipped (healthy, empty) digest stays silent on the email channel too.
- **Compute benchmark harness (`bench`).** Runnable, deterministic micro-benchmarks for the pure
  fold/analytics functions the product derives every portfolio/report from — the per-function latency
  + throughput evidence the HTTP stress test can't give in isolation. `pnpm --filter
  @workspace/api-server run bench` covers the portfolio-scale gateway folds (seeded fixtures, JIT
  warmup, inner-batch calibration, p50/p90/p99 + ops/sec, `BENCH_REPORT` JSON, and `BENCH_MAX_P99_MS`
  as an optional regression gate); `pnpm --filter @workspace/omniproject run bench` covers the heaviest
  SPA analytics (Monte-Carlo, critical path) via `vitest bench`. Neither needs a network or server
  boot. Documented in `docs/ops/BENCHMARKS.md`.

- **ERP connector: Oracle Fusion Cloud ERP read-only broker adapter (backlog #139).**
  A new catalogued, capability-declared backend —
  `lib/backend-catalogue/vendors/backends/oracle-fusion-erp.json` — for Oracle
  Fusion Cloud ERP's Project Financial Management module, following the same
  reference-mapping pattern as SAP/NetSuite/Primavera/Dynamics 365 (backlog #23).
  - Declares only the capabilities the real, published `fscmRestApi` REST API
    genuinely backs: `financials` (`projectCosts`, `projectBudgets` +
    `projectBudgetSummary`, `projectCommitments`) and `issues` (`projectPlans`
    WBS tasks, the generic work-item proxy every catalogued backend maps to).
    Financial data is read-only structurally — the broker contract has no write
    action for cost/budget/commitment data on any backend, this one included.
  - Reuses eight existing canonical fields (`budget`, `plannedCost`, `actualCost`,
    `currency`, `costCenter`, `committedCost`, `purchaseOrder`, `wbsCode`) via a
    new `fieldKeys[]` vendor-JSON property (`BackendManifest.fieldKeys`,
    `lib/backend-catalogue/src/backend-manifest.ts`) instead of duplicating field
    definitions — validated as a subset of the field superset by the existing
    `guard-superset` CI check.
  - Auth defaults to HTTP Basic (Oracle Fusion's OWSM-secured REST APIs accept it
    out of the box), with OAuth2/IAM client-credentials documented as the
    alternative for MFA-enforced tenants.
  - Added to `ENTERPRISE_BACKENDS` (premium n8n workflow generation, matching the
    other large corporate ERPs). Generated-workflow output was verified to
    produce a sensible 15-node scaffold via `generateWorkflow()`.
  - **Catalogued, not live-verified**: this connector has not been exercised
    against a real Oracle Fusion tenant (none was available to test against).
    See [docs/vendors/ORACLE-FUSION-ERP.md](docs/vendors/ORACLE-FUSION-ERP.md)
    for exactly what's mapped, the cited REST resource paths, and what a
    maintainer must confirm against a live pod before calling it "supported."
- **Report builder: multi-level group-by + trend/line chart (backlog #133).** Extends the bespoke
  report generator (backlog #105) past a single group-by and two viz types, without redesigning it:
  - **Second group-by level (`groupBy2`)** turns a report into a genuine cross-tab: `groupBy` gives
    the pivot's rows, `groupBy2` its columns, with a value in every (row, column) cell — not a
    compound key collapsed back to one dimension (`runCustomReport` in
    `artifacts/omniproject/src/lib/custom-report.ts`, `CustomReportGroup.pivot` +
    `CustomReportResult.columns`). The first metric is what's shown in the cross-tab cell; every
    metric still totals per row in the existing table. Rendered as a second table under the
    single-level view (`CustomReport.tsx`), and authored via a "Then by (pivot columns)" select that
    only appears once a first group-by is chosen (`CustomReportsAdmin.tsx`).
  - **`viz: "line"`** trends a metric over time instead of grouping by a category: a new `dateField`
    on the report def is bucketed by calendar month and the metrics aggregated per month
    (`runCustomReportTrend`), rendered as a Recharts `LineChart` + a month table, computed live over
    the read model like every other report — nothing but the definition persists in
    `settings.customReports`. Authored via a viz dropdown option plus a date-field select that
    replaces the group-by controls when `viz === "line"`.
  - Both extensions thread through the whole stack the original feature already had: the export/import
    round-trip (`custom-report-file.ts`), the server-side shape validation
    (`artifacts/api-server/src/lib/settings.ts` `validateCustomReports`), and the PMO-gated
    `PUT /api/reports/custom` route — unchanged besides the wider `viz` union and two new optional
    string fields.
- **ERP connector: SAP S/4HANA (PS/PPM) read-only financials adapter.** A new catalogued backend,
  `sap-s4hana-financials` (`lib/backend-catalogue/vendors/backends/sap-s4hana-financials.json`),
  reading SAP Project System/PPM cost-object financial context — budget, actual costs, cost center —
  through the same broker seam OmniProject already reads Jira/ADO issues through. Deliberately
  read-only (only `list_projects`/`list_issues`; no create/update/delete) and additive alongside the
  existing write-capable `sap` (WBS-element editor) backend, keeping "PM overlay, not an ERP" honest:
  this connector exists to surface finance context, not to manage SAP projects.
  - Real, cited SAP OData surface: `API_ENTERPRISE_PROJECT_SRV` (WBS/project master data, read-only
    `$select`), the released CDS view `I_ProjectActualCosts` (actual costs, backed by the universal
    journal), with `API_FINPLANNINGDATA_SRV` (plan/budget) and `CE_COSTCENTER_0001` (cost-center
    master data) documented as follow-up lookups an operator wires in separately.
  - Maps to the **existing** canonical financial fields (`wbsCode`, `costCenter`, `currency`,
    `budget`, `plannedCost`, `actualCost`, `committedCost`, `capitalised`, `expenditureType`,
    `capexAmount`, `opexAmount`, `costCategory`, `depreciationMonths`, `purchaseOrder`, `parentTask`)
    via the vendor JSON's `fieldKeys[]` — the first backend to exercise that (already schema-supported,
    previously unused) mapping mechanism, reusing rather than duplicating the registry.
    `BackendManifest` (`lib/backend-catalogue/src/backend-manifest.ts`) gained the corresponding
    `fieldKeys?: string[]` type field.
  - Capability-honest (`financials`/`portfolio`/`issues` only — no `scheduling`/`resources`/`raid`/
    `baseline`, since this connector reads none of that data) and enterprise-tier, same as `sap`.
    Verified `generateWorkflow()` produces a genuinely read-only n8n scaffold (two HTTP-request nodes,
    no writes) — committed as `artifacts/n8n-blueprints/generated/omniproject-sap-s4hana-financials.json`.
  - **Honesty note:** catalogued and passes every automated gate (schema, capability-honesty,
    field-superset, typecheck), but **not yet verified against a live S/4HANA tenant** — none is
    available in this environment. See `docs/vendors/SAP-S4HANA-PS-PPM.md` for the full citation
    trail and the verification checklist before calling this "supported" rather than "catalogued".
- **ERP connector: Dynamics 365 Finance & Operations, read-only (backlog #141).** A new
  catalogued backend, `dynamics365-fo` (`lib/backend-catalogue/vendors/backends/dynamics365-fo.json`),
  for D365 Finance & Operations' Project Management and Accounting module — distinct from the
  existing `dynamics365` entry (Project Operations on Dataverse): different OData Web API,
  different credential (generic OAuth2, not n8n's Dataverse-specific one), finance-first rather
  than task-first.
  - Maps real, documented F&O entities (Microsoft Common Data Model schema): `ProjectsV2` →
    project, `ProjectTasks` (WBS lines) → issue, `ProjProposalCost` (budget/estimate) and
    `ProjCostTrans` (posted actual cost) back the `financials` capability. Reuses existing
    canonical fields (`budget`, `plannedCost`, `actualCost`, `currency`, `costCenter`, …) via the
    `fieldKeys` mechanism — the first vendor to use it — validated against the superset by
    `guard-superset` (`BackendManifest` gained the matching `fields`/`fieldKeys` optional
    properties, previously schema-only and untyped).
  - Capability-honest: only `financials`/`issues`/`scheduling` are declared — `baseline`, `raid`,
    `resources` and `portfolio` are explicitly left off pending a confirmed entity, rather than
    guessed at. Added to the enterprise tier (`isEnterpriseBackend`) alongside SAP/NetSuite/Planview.
  - `generateWorkflow()` verified to produce a real, importable n8n scaffold (all 5 contract
    actions wired as HTTP-request nodes) — see `artifacts/n8n-blueprints/generated/omniproject-dynamics365-fo.json`.
  - **Catalogued, not tenant-verified**: no live F&O tenant was available to test against; every
    entity/field/key name is a reference mapping, same posture as SAP/NetSuite/Planview/Primavera.
    See `docs/vendors/DYNAMICS-365-FO.md` and `docs/PARKED-DECISIONS.md` §E4 for exactly what
    still needs confirming against a real tenant before this is "supported" rather than "catalogued."
- **Self-service custom-backend authoring in the admin UI (backlog #137).** A customer's own team
  can now author a new backend/vendor definition through a guided form instead of hand-editing
  `lib/backend-catalogue/vendors/backends/<id>.json`. Investigated first: the runtime-load half
  already existed (backlog #31's `OMNI_CONFIG_DIR/vendors/backends/*.json`, validated + merged over
  the shipped catalogue at boot by `config-dir.ts`/`vendor-overlay.ts`) — the missing piece was the
  authoring UI, not a new persistence mechanism.
  - `CustomBackendAdmin` (`artifacts/omniproject/src/components/settings/CustomBackendAdmin.tsx`,
    admin-gated like every other technical-config settings surface) builds a full
    `BackendManifest & N8nBinding` document — identity, capabilities (against the known capability
    domains), required env, key format, the n8n per-user auth header, and all six contract actions
    (HTTP or native n8n node, with parameters as JSON) — with a live JSON preview and inline
    validation. "Start from" clones any shipped catalogue backend as a template; "Import file…"
    resumes an exported or hand-written definition.
  - `evaluateDraft` (`artifacts/omniproject/src/lib/backend-authoring.ts`) validates against the
    *exact same* embedded JSON Schema the config-dir loader enforces
    (`validateVendor("backends", …)` from `@workspace/backend-catalogue`, unchanged) plus a few
    authoring-time advisories (unrecognised capability id, no actions mapped, id collides with a
    shipped backend) — "valid in the form" ⇔ "the loader will accept it".
  - Deliberately export-first, not a live write: the SPA downloads the validated JSON for the admin
    to place at `$OMNI_CONFIG_DIR/vendors/backends/<id>.json` and reload/restart — writing to the
    server's filesystem from the SPA has no place in a stateless/zero-at-rest gateway. True
    zero-restart activation (no operator step at all) is parked — see `docs/PARKED-DECISIONS.md`
    §G1 — pending a deliberate hot-reload design for the backend catalogue.
- **Cross-instance portfolio federation, residency-respecting (backlog #135).** Per-country data
  residency (backlog #97) naturally pushes a multinational toward one OmniProject instance per
  region/subsidiary — this closes the resulting gap: no consolidated global portfolio view. A minimal,
  stateless fan-out that respects the SAME posture as the rest of the residency story — only a
  pre-aggregated summary ever crosses an instance boundary, never a raw project/issue record.
  - **`PortfolioSummary`** (`artifacts/api-server/src/lib/portfolio-summary.ts`): a new portfolio-wide
    aggregate (`summarizeHealth`/`foldFinance`/`foldCapacity`) reducing the existing per-project
    `portfolioHealth`/`projectFinancials`/`resourceCapacity` broker reads to portfolio-total counts and
    sums — no project id/name, programme id/name, or person's name ever survives the fold. Served at
    `GET /portfolio/summary`, the ONE endpoint a peer instance calls.
  - **`settings.federatedPeers: PeerInstance[]`** — the peer registry (base URL + bearer token +
    region label per peer), admin-gated and masked on read exactly like an outbound webhook secret.
    The token must be one of the PEER's own `API_TOKENS` (`lib/api-token.ts`) — no new cross-instance
    auth scheme, just this instance acting as a read-only API-token client of the peer. New
    `GET`/`PUT /api/federated-peers` routes; a masked resubmit preserves the real token.
  - **`GET /api/federated-portfolio`** (`lib/federation.ts`) fans out live to every active peer's
    `/portfolio/summary` and merges the result with this instance's own into one `FederatedPortfolio`:
    `local` + a `peers` array, each entry clearly labeled by id/label/region and a `status` (`ok` /
    `unreachable` / `unauthorized` / `error`) — never silently blended into one number. An
    unreachable/misconfigured peer degrades to a labeled "unavailable" contribution instead of failing
    the whole view (mirrors the outbound-webhook delivery fan-out and an FX-rate fallback).
  - A new **Federated Portfolio** report (`FederatedPortfolio.tsx`, wired into `Reports.tsx` +
    the report-renderer registry) surfaces the combined rollup; a **Federated peers** admin panel
    (`FederatedPeersAdmin.tsx`, Settings page) manages the peer registry.
  - Stateless throughout: nothing is cached beyond the peer config itself: every view re-fans-out
    live. See `docs/DATA-RESIDENCY.md` → "Cross-instance federation" for exactly what does/doesn't
    cross an instance boundary.
- **Bulk feature-gating import/export (backlog #136).** The hierarchical feature-gating model
  (backlog #88 — org→programme→project `programmeFeatures`/`projectFeatures` scope config) was only
  editable one programme or project at a time; at real scale (e.g. 200 projects) that's hundreds of
  form edits. Additive bulk tooling in Settings → Feature governance:
  - **Export**: `lib/feature-gating-csv.ts`'s `buildFeatureGatingExportRows` + `featureGatingRowsToCsv`
    emit one CSV row per known programme/project (even ones with no override yet, so a PMO edits a
    populated spreadsheet rather than hand-typing every id), one pipe-separated column per gating
    dimension (`disabled`/`required`/`forbidden`) — RFC-4180 escaped (including the CSV-injection
    formula-trigger guard already used server-side), UTF-8 BOM prefixed for Excel.
  - **Import**: a hand-rolled RFC-4180 parser (`parseCsvText`) + `parseFeatureGatingCsv` validates every
    row — an unrecognised feature id or a same-row required+forbidden clash REJECTS that row with a
    clear message (others still parse); an unrecognised programme/project id is a WARNING, not a fatal
    abort (the per-scope PUT route is the actual ownership authority). `diffGatingRow` computes a
    per-row new/changed/unchanged diff (with per-dimension added/removed ids) against the CURRENT
    config, shown as a preview before any write. Confirming applies through the EXACT SAME
    `PUT /features/programme/:id` / `PUT /features/project/:id` routes the one-at-a-time
    `FeatureGovernance` admin panel already uses — looped sequentially (never in parallel, since each
    PUT does a read-modify-write over the shared settings map) so ownership/ceiling validation and
    audit logging are identical to a hand-edited single save, never bypassed for the bulk path. Only
    rows that actually change are sent; a per-row failure (e.g. "not owned") is reported without
    aborting the rest of the batch.
  - New `FeatureGatingBulkAdmin.tsx` component, mounted alongside (not replacing) `FeatureGovernance`;
    new `useScopeFeatureMaps` hook reads the raw override maps via the existing `GET /api/settings`.
    No new backend routes, no new persistence — reads/writes the exact same
    `settings.programmeFeatures`/`projectFeatures` the single-scope UI already uses. Bulk-editing
    `governanceRules` (the conditional PMO mandates) is deliberately left for a follow-on — it already
    has its own dedicated admin UI (`GovernanceRulesAdmin`) and a CSV shape for predicate-bearing rules
    is a different (bigger) problem than this flat per-scope table.
- **ERP connector hardening: Oracle NetSuite read-through capability-honesty
  pass (backlog #140).** The NetSuite backend manifest
  (`lib/backend-catalogue/vendors/backends/netsuite.json`, seeded in #158)
  already passes every structural catalogue check; this change strengthens its
  documentation and verification rather than re-implementing it:
  - `notes` now cites the real SuiteTalk REST record types behind each
    capability (`job` → project, `projectTask` → issue/scheduling,
    `resourceAllocation` → resources, `job` job-costing +
    `expenseReport`/`timeBill` roll-ups → financials), calls out NetSuite's
    **SuiteQL** endpoint as the realistic path for aggregated budget-vs-actual
    reads, and documents OAuth 1.0a TBA vs OAuth 2.0 M2M as NetSuite's two real
    auth options (TBA remains the modelled default).
  - New `docs/vendors/NETSUITE.md` makes explicit that this connector is
    **catalogued, not live-verified** — authored from NetSuite's public
    SuiteTalk REST documentation with no live tenant available in this
    environment — and states exactly what would need to happen before calling
    it "supported."
  - Verified `generateWorkflow()` actually produces a sensible, importable
    workflow for NetSuite: added
    `artifacts/n8n-blueprints/generated/omniproject-netsuite.json` (webhook →
    verify/loop guards → switch router → 5 SuiteTalk REST HTTP nodes with
    `oAuth1Api` credential placeholders → normalize → respond) via
    `pnpm --filter @workspace/scripts run gen-n8n-blueprints`.
  - Re-ran the bundled-backends stress harness (163/163 pass, including
    NetSuite's schema/capability/spoof-gating/messy-data assertions) and the
    `lib/backend-catalogue` unit suite (100/100) after regenerating the vendor
    catalogue (`gen-vendors`) — zero drift, zero regressions.
- **Portfolio copilot: conversational action-invocation (backlog #134).** The copilot chat
  (backlog #61, Q&A-only) can now invoke the same canonical actions as the NL→action command
  palette (backlog #59) — a PM can type "mark issue 42 done" straight into the copilot instead
  of switching to the palette.
  - Every copilot message is first offered to the SAME planner the command palette calls
    (`planNlAction` → `POST /api/ai/nl-action`), against the SAME governed, approved-actions-
    filtered tool catalogue. A recognised action (or a clarify) shows the identical
    confirm-before-execute plan card and executes through the identical `POST /api/mcp`
    `tools/call` write path on confirm — same RBAC, governance, write-scope and audit
    re-enforcement as the palette. A "none" verdict falls straight through to the unchanged
    read-only Q&A answer; no new NLU/matching logic was written, and no existing
    confirm/consent/step-up gate was touched or weakened.
  - Extracted the plan-review card shared by both surfaces into
    `artifacts/omniproject/src/components/ActionPlanCard.tsx` (namespaced `data-testid`s via
    `testIdPrefix` so the command palette and the copilot can both render on the Settings
    page without colliding) — one renderer instead of a fork per surface.
    `artifacts/omniproject/src/components/settings/NlCommand.tsx` now consumes it too, with no
    behaviour change (existing tests pass unmodified).
  - Known trade-off (documented in `docs/FEATURE-MATURITY.md`): a plain Q&A message now costs
    an extra planner round-trip before the Q&A call, since detection reuses the existing
    LLM-backed planner rather than adding a separate fast heuristic classifier.
- **`drillTo` — one-click red-number → blocked tickets (backlog #122).** Declarative drill-down for
  reports and dashboard widgets, closing the gap the component-library follow-on slice above
  deliberately left open: a red "N blocked" figure is now a real link straight to the filtered
  work-item grid — no manual filter-building.
  - `LibraryComponent`/`ReportDefinition`/`WidgetDefinition` gained an optional `drillTo` descriptor
    (`lib/backend-catalogue/src/drill-to.ts`), authored per report/widget JSON (new `drillTo` schema
    field on `assets/schema/report.schema.json` / `widget.schema.json`) and threaded through
    `componentLibrary()` — the same field-in-JSON pattern as `refresh`. The descriptor reuses the
    predicate engine's own shape (`field`/`op`/`value`, all-of/any-of — see `lib/rate-card.ts`
    `Predicate`/`ConditionSet`), plus `predicateFrom` to derive a condition's value from the clicked
    data point (`fromField`) instead of a literal.
  - The SPA resolver (`artifacts/omniproject/src/lib/drill-to.ts`, `resolveDrillTo`) turns a
    `DrillTo` + the specific row a user clicked into a concrete grid href, carrying the resolved
    predicate as a `filter`/`filterLabel` query param — purely client-side navigation + URL state,
    nothing persisted, nothing broker-side. `IssueGrid` reads it back (`readDrillFilter`), pre-filters
    its rows through the SAME `matchRow` engine the custom report builder already runs saved filters
    through, and shows a "Filtered — <label> (N of M) · Clear filter" banner; `ProjectDetail` lands
    straight on the grid (instead of the board) when a drill-through filter is present.
  - Wired end-to-end into the portfolioHealth widget's BLOCKERS figure
    (`assets/widgets/portfolioHealth.json` declares `drillTo: blocked truthy`, consumed by
    `PortfolioKpi`) and reused as-is (same descriptor, same resolver) for the exec board pack's
    exceptions-table blocker count (`ExecBoardPack`) — one declarative descriptor, two surfaces,
    proving the mechanism composes instead of every "N blocked" figure hand-rolling its own
    filter-building. Left generic for other reports/widgets to adopt the same way.
- **`drillTo` everywhere — schedule variance, budget overrun and PRINCE2 exceptions now click through
  too (backlog #132).** Retrofits the declarative drill-down onto the other "red number" spots a PM
  expects to click through, beyond the portfolioHealth widget's BLOCKERS figure:
  - Two more descriptors in `artifacts/omniproject/src/lib/drill-to.ts` — `overdueDrillTo` (a
    project's overdue, still-open items — mirrors `isOverdue` in `methodology.ts`) and
    `costOverrunDrillTo` (items with actual cost logged) — built in code rather than declared in a
    catalogue JSON asset like portfolioHealth's static `blocked truthy`, since "overdue" depends on
    today's date and "cost-incurring" isn't a fixed literal. Both resolve through the SAME
    `resolveDrillTo` as every other drillTo.
  - Wired into SCHED Δ and BUDGET Δ on the portfolio KPI cards (`PortfolioKpi`) and the exec board
    pack's exceptions table (`ExecBoardPack`) — the same two figures across both surfaces the
    BLOCKERS drill-through already covers — plus the PRINCE2 highlight report's "Exceptions (overdue)"
    tally (`Prince2View`), a third, differently-shaped surface (single-project, not portfolio-rollup)
    proving the descriptors compose across report types.
  - **Predicate-engine fix (`custom-report.ts` `evalPredicate`):** `gt`/`gte`/`lt`/`lte` now fall back
    to a date-aware comparison when a field isn't numeric (e.g. `dueDate`, an ISO date string) —
    previously any date comparison silently evaluated to `false` (`Number("2026-07-01")` is `NaN`),
    which would have made the overdue drill-through resolve to a filter that never matches. A genuine
    gap in the shared predicate engine the grid's drill-through filter and the custom report builder
    both run on; the resolver itself (`resolveDrillTo`/`readDrillFilter`) is unchanged.
- **Multi-currency portfolio consolidation, hardened: FX as-of-date policy + per-row local-currency
  display.** At 7+ countries every financial roll-up already converted into one reporting currency
  (`settings.reportingCurrency`, org default + PMO/admin-settable) — this hardens the consolidation
  itself:
  - **FX rate-source + as-of-date policy** (`settings.fxRatePolicy`: `spot` | `periodClose` |
    `budgetRate`, plus `settings.fxRateAsOfDate`) lets an org pin consolidated reports to today's
    live rate, a period-close rate, or the rate the budget was set at, instead of always the FX
    table's current spot rate — so board-pack variance isn't polluted by day-to-day FX drift.
    `broker.fxRates(ctx, opts?)` gained an optional `{ asOf }` hint (additive, backward-compatible);
    `GET /fx-rates` takes an optional `asOf` query param. A broker that can't serve a historical rate
    for an arbitrary date degrades gracefully to its live snapshot (the reference/demo brokers do
    this); still read live through the broker on every request — never cached or stored.
  - **Per-programme/project local-currency display.** `consolidateFinancials` (`FinanceRollup`) and
    `rollupIncome`/`rollupBenefits` (`IncomeRollup`/`BenefitsRollup`) now carry `localCurrency` +
    `local` totals alongside the consolidated figures — the row's own un-converted currency/amount
    when every project folded into it shares one currency (most Standalone rows; a single-country
    programme), `null` once a row mixes ≥2 currencies. `PortfolioFinancials`, `PortfolioIncome` and
    `PortfolioBenefits` show that local figure as a sub-line under the programme label.
  - New Settings UI: an "FX as-of-date policy" selector + date picker alongside the existing
    reporting-currency field.
- **Unified component library — follow-on slices: declarative refresh, content pages, board-pack
  extras.** Three gaps left open by the original component-library unification (`lib/backend-catalogue/src/component-library.ts`)
  are now wired into real production code, not just tests:
  - **Declarative auto-refresh.** `LibraryComponent` gained an optional `refresh?: number` (seconds),
    authored per report/widget JSON (`assets/reports/*.json`, `assets/widgets/*.json`, new
    `refresh` schema field) and threaded through `componentLibrary()`. The new SPA
    `LibraryComponentView` (`components/library/LibraryComponentView.tsx`) polls (invalidates active
    queries) on that cadence — so a component declares its own refresh interval instead of each
    renderer hardcoding its own `setInterval`.
  - **Content pages** — a new, minimal surface for the `"content"` placement (previously
    type-only/test-only). PMOs compose named pages as a flat, ordered list of library component ids
    under Settings → Content pages (`components/settings/ContentPagesAdmin.tsx`), persisted as
    `settings.contentPages` via `GET/PUT /api/content-pages` (open read, PMO-gated write — same
    shape as the report generator's `customReports`). Everyone views them at the new `/content`
    route (`pages/ContentPages.tsx`), gated by a new `contentPages` feature module.
  - **Board-pack extras** — the `"export"` placement (previously unused outside tests) is now wired
    into `ExecBoardPack`: a picker lets the user add any `componentsFor("export")` component to the
    board pack ad hoc, on top of the fixed sections, instead of only ever capturing a hardcoded set.
  - `drillTo`/backlog #122 is intentionally NOT part of this slice — `LibraryComponent`/`renderer`
    are left extensible for it.
- **Cross-programme / cross-border resource levelling.** A new portfolio-level report
  (`resource-levelling`, "Cross-programme Resource Levelling") built on top of the existing
  capacity roll-up (`rollupByProgramme`) and the what-if concurrency model's base-vs-scenario
  pattern, so managers can ACT on the contention the roll-up already shows:
  - `lib/resource-levelling.ts` (`levelPortfolio`) sums a person's allocation ACROSS every
    project/programme they touch, portfolio-wide — surfacing over-allocation a single project's
    view can't (e.g. 60%/60% across two projects, fine per-row, 120% person-wide) — and flags
    people whose allocations span more than one programme or declared country.
  - `skillsSupplyDemand` balances a simple skill/tag supply (available hours) vs demand (assigned
    hours) per declared skill — deliberately a flat tag list (`ResourceCapacity.skills`, new
    optional field), not a taxonomy system.
  - `simulateMove` is a pure WHAT-IF (mirrors `resource-load.ts`'s `loadDeltas`: nothing written
    back) that models shifting a slice of one resource's allocation between two projects and
    returns the before/after `CapacityRollup` — and its over-allocation/utilisation deltas — for
    BOTH the origin and destination programme.
  - **Data residency**: `residencyGate` reuses the SAME allowed-region policy the broker/egress
    hop already enforces (`artifacts/api-server/src/lib/data-residency.ts`), surfaced non-admin-safe
    (region codes only, never URLs/secrets) via a new `Capabilities.residency` field from
    `GET /api/capabilities`. Fail-closed: once enforcement is on, a modelled move for a resource
    with no declared country — or one outside the allowed set — is refused, exactly like an
    undeclared broker-endpoint region. Read-only surfacing needs no extra gate: the data already
    passed the broker/egress residency check to reach the read model.
  - `ResourceCapacity` gained two new optional fields (`country`, `skills`) to carry this; both
    additive/backward-compatible.

### Documentation

- **Documentation reduction — archived point-in-time audits + de-duplicated prose.** Moved three
  dated/closed review artefacts (`AUDIT-2026-07.md`, `ZERO-TRUST-AUDIT-2026-07.md`,
  `SME-CHARITY-FIT.md`) into `docs/archive/reviews/` (joining the already-archived
  `SECURITY-AUDIT-2026-07.md`) so the maintained tree carries only living docs, and trimmed prose in
  `docs/TECHNICAL.md` and the onboarding guides that verbatim-duplicated `LICENSING.md` and the
  README's "why this exists" framing. `docs/DOCUMENTATION-INDEX.md`, `docs/archive/README.md`, and
  every inbound link (`README.md`, `docs/SECURITY-AUDIT.md`) were updated and link-integrity verified.
  Zero information loss — content is relocated or replaced by a link, not deleted.
- **Closed backlog #108 (multi-broker read fan-out) with a documented decision instead of
  speculative code** (`docs/PARKED-DECISIONS.md`, section D). Investigated whether the gateway
  should hold multiple distinct data-broker adapter instances of the same kind (e.g. two
  separate Jira-kind endpoints) and fan a single read across them, merged by `qualifiedId`.
  Found no genuine unmet need: `connectedBrokers()`/`brokerForCommand()` already do cross-kind
  capability routing (one adapter instance per kind; n8n for data + Make for events) and
  intentionally dedupe by kind; the existing same-kind `BROKER_URLS`/`BROKER_ENDPOINTS` pool is a
  horizontal-scale replica pool (round-robin/failover), not a fan-out source list; and merging
  genuinely distinct same-kind backends is already the broker/workflow layer's job one level below
  the seam (`docs/BROKER.md`'s "one workflow per backend"). Recorded the evidence and closed the
  item without adding code.
- **Documentation-linking and cross-reference pass.** Every doc under `docs/` is now
  reachable from `README.md`: 27 docs that existed but weren't linked from anywhere
  reachable from the README (architecture/quality/security audits, the SSO/SCIM and
  data-residency runbooks, operations, i18n coverage, and several design proposals)
  are now linked from the README's audience doors, `docs/TECHNICAL.md`, and/or the
  new **[docs/DOCUMENTATION-INDEX.md](docs/DOCUMENTATION-INDEX.md)** — a short map of
  every doc by audience/purpose (architecture & internals, security & compliance,
  operations & scale, product & buyer, audit findings).
- Fixed stale cross-references left over from the `src/broker/n8n.ts` → `src/broker/n8n/index.ts`
  refactor (`docs/BROKER.md`, `docs/TECHNICAL.md`), and broken relative links in
  `docs/SCALING.md`, `docs/SECURITY-AUDIT.md` and `LICENSING.md` that pointed at
  `docs/ops/*` files by their old top-level paths.

### Performance

- **Bounded portfolio fan-out (Theme A of `docs/archive/reviews/PERF-PATTERNS-REVIEW.md`) — the biggest scale risk
  at the 60/200 target.** A tiny hand-rolled concurrency pool (`poolMap`/`createConcurrencyLimiter`;
  no new dependency) now caps every "one call per project" fan-out instead of firing all ~200
  concurrently:
  - `routes/export.ts` + `routes/odata.ts` — the duplicated, unbounded `allIssues()` is now one
    shared, bounded (10-wide) helper (`lib/portfolio-reads.ts`), used by both the exporters and the
    OData feed; the xlsx exporter also no longer fetches the project list twice.
  - `routes/projects.ts` `GET /resources` — the member-roster fan-out is bounded to 10-wide.
  - `broker/n8n/index.ts` `verify()` — the probe fan-out is bounded to 5-wide, so the diagnostic
    path can't itself become the herd single-flight exists to prevent.
  - `pages/MyWork.tsx` and `components/search/GlobalSearch.tsx` — the per-project `useQueries`
    issue fetches are bounded (8-wide) via a client-side limiter wrapping each `queryFn`.
  - `lib/explore-replica.ts` `captureReplica` — the 7 per-project sub-resource reads now run in
    parallel (`Promise.all`) and the outer per-project loop is bounded to 8-wide: was 200×7=1,400
    fully-serialized round-trips (~3 min), now seconds.
  - `lib/prefetch.ts` `runPredictive` — speculative prefetches are now bounded to 6 in flight.
- **Static derivations memoized at module scope (Theme B) — O(catalogue)/O(n²) → O(1)/O(n) on hot
  paths.**
  - `lib/feature-modules.ts` — `governanceCatalogue()`/`governanceGates()` (feature modules + every
    report + every methodology) are now built once and cached, instead of rebuilt + reallocated on
    every gated request.
  - `lib/backend-catalogue/src/component-library.ts` — the component `LIBRARY` is built once at
    module load; `getComponent` is backed by a `Map` (O(1) instead of a linear rebuild-then-`.find`
    on every dashboard/report render).
  - `broker/registry.ts` — `brokerForCommand` no longer re-runs `connectedBrokers()` once per
    candidate inside its filter (was O(n²) on the broker write-routing path); the supporting-kind
    set is now resolved once per call.
  - `broker/router.ts` — `endpointsForKind` now memoizes the parsed `BROKER_ENDPOINTS` map, keyed
    on the raw env value (still re-parses on a hot-reloaded change), instead of re-parsing the
    string on every routed call.
- **Stabilized `useQueries` derivations (Theme C) — the dominant user-perceptible jank source.**
  `use-portfolio-items.ts`, `MyWork.tsx`, `GlobalSearch.tsx`, `ExecBoardPack.tsx`,
  `CapacityRollup.tsx`, `PortfolioRoadmap.tsx`, and `widgets.tsx` (`CapacityActualsWidget`) now use
  React Query's `combine` option so the per-project result array is referentially stable across
  renders that don't change the underlying data. Previously a bare `useQueries()` array got a new
  reference every render, forcing the downstream `useMemo` to re-run its full O(200-project)
  aggregation on every unrelated re-render (tab switch, sibling widget settling, every keystroke).

  See `docs/archive/reviews/PERF-PATTERNS-REVIEW.md` for the full findings this scoped pass addresses.
### Security

- **Fixed a silent-failure bug on two SPA admin mutation clients (from the clean-code audit's Theme
  B/#1–#2).** `lib/security.ts`'s `revokeKey` / `revokeUserSessions` and `lib/tools.ts`'s
  `saveCapability` / `testCapabilityEndpoint` were the only mutation clients in the SPA that skipped
  the `res.ok` check every sibling (`exportConfigBundle`, `setMaintenance`, `containment.ts`,
  `feature.ts`, `actions.ts`) already applies — a **failed** key revoke, session revoke, capability
  save, or endpoint probe resolved as success with no error surfaced to the admin. All four now
  `throw responseError(res, await safeJson(res))` on a non-OK response, matching every other client.
  Regression tests cover the previously-silent failure path for each function.
- **Deduplicated constant-time string equality (clean-code audit Theme A/#3).** Five files
  (`api-token.ts`, `csrf.ts`, `broker-hmac.ts`, `scim.ts`, `provenance.ts`) each hand-rolled the same
  length-check-then-`crypto.timingSafeEqual` comparison for tokens/HMACs/CSRF double-submit/SCIM
  bearer checks. Added one `constantTimeEqual(a, b)` to `crypto-keys.ts` (the existing home for shared
  crypto primitives) and routed all five call sites through it — same timing-safety guarantee, same
  return semantics, one implementation to keep correct.

### Changed

- **Landed a scoped subset of the clean-code audit's Top-20 duplication fixes** (`docs/archive/reviews/CLEAN-CODE-AUDIT.md`),
  chosen for being low-risk and behaviour-preserving:
  - A shared `num()` finite-coercion helper (`lib/num.ts`) replaces five copy-pasted copies in
    `capex.ts`, `benefits.ts`, `income.ts`, `financial-summary.ts`, `capacity-actuals.ts`.
  - `RAG_DOT` / `RAG_TEXT` are now imported from `lib/methodology.ts` instead of being re-declared
    inline in `Programmes.tsx`, `ProgrammeDetail.tsx`, `ProgrammeFinancialsCard.tsx`,
    `ProjectFinancialsStrip.tsx`, and `FinancialEvmChart.tsx`.
  - A new `useDisplayCurrency(native)` hook (`lib/currency.ts`) replaces the copy-pasted
    display-currency-picker block in the same three financials components.
  - `config-snapshot.ts`'s `buildSnapshot` now derives its captured field set from `SNAPSHOT_KEYS`
    instead of hand-listing the same fields a second time, so the two can't silently drift.
  - A new `actorForAudit(req)` helper (`lib/audit.ts`) calls `getSession(req)` once instead of the
    twice every audit call site (`rate-card.ts`, `ruleset.ts` ×3, `role-map.ts`, `snapshots.ts`) used
    to call it to build the same `{ sub, role }` actor shape.
  - Removed the dead, uncalled `N8nBroker.command()` (all real traffic goes through
    `commandWithSource`; `command` isn't part of the `Broker` interface).
  - Fixed a pre-existing `tsc --noEmit` type error in `lib/backend-catalogue/src/view-catalogue.test.ts`
    (an unchecked array index under `noUncheckedIndexedAccess`) found while running the full typecheck
    for this pass.
### Added

- **"We're a charity" one-click onboarding preset.** A single admin action
  (`POST /api/setup/charity-onboarding`, surfaced as a button in the setup wizard's
  deployment-type step) now does in one click what previously took three separate
  steps: selects the `nonprofit` deployment profile, mints two new dashboard presets —
  **trustee report** and **funder report**, assembled entirely from existing widgets
  (`lib/backend-catalogue/assets/dashboard-presets/{trustee-report,funder-report}.json`)
  — as saved dashboards, and best-effort adopts the active backend's nomenclature
  preset if one exists and the deployment is entitled to it. Idempotent (re-running
  it never duplicates a dashboard) and purely additive (never removes an existing
  dashboard or setting). The dashboard-preset `role` enum gained two audience-tailored
  values, `trustee` and `funder`, alongside the existing org-chart-level personas.
- **Portfolio Prioritisation & Funding Funnel** — ranks every project on a weighted composite of its
  RICE / WSJF / MoSCoW (agile field group), strategic-goal contribution (strategy field group) and
  risk-adjusted benefits realisation (benefits field group), shown against its cost + capacity
  footprint, so the PMO can rank ~200 competing projects and run a fund/defer/cut what-if with a live
  budget/capacity/benefit impact. STATELESS: the score and the scenario are both computed live over
  the read model on every request (`lib/portfolio-priority.ts`, `lib/funding-scenario.ts`, unit
  tested) — only the dimension WEIGHTS are config (PMO-gated `GET/PUT /api/portfolio/priority-weights`,
  a Settings admin panel). `riceScore`, `wsjf`, `moscow`, `strategicContribution` and `strategicGoals`
  — previously registry-only (`lib/backend-catalogue/assets/fields.json`) — are now wire-typed on
  `Issue`, mirroring how the benefits/CapEx groups were promoted. New report:
  **Portfolio Prioritisation & Funding Funnel** (`components/reports/PortfolioPrioritisation.tsx`),
  wired into the Reports page.
### Fixed

- **n8n blueprint docs pointed at deleted files; the pre-generated examples had no drift guard.**
  `artifacts/n8n-blueprints/README.md` (plus `docs/N8N-WORKFLOWS.md`, `docs/dev/PLANE-BACKENDS.md`,
  `docs/BROKER.md`, `CONTRIBUTING.md`, `LICENSING.md`) still described a "backend library" and
  "generator" at `artifacts/api-server/src/lib/n8n-backends.ts` / `n8n-generator.ts` — both removed
  when the backend catalogue moved to `lib/backend-catalogue/src/backend-catalogue.ts` +
  `n8n-generator.ts` with per-vendor JSON under `lib/backend-catalogue/vendors/backends/`. Repointed
  every stale reference at the live files/route (`POST /api/setup/generate-workflow`) and the current
  "author a JSON file, run `gen-vendors`" workflow. Separately, the five hand-committed example
  workflows under `artifacts/n8n-blueprints/generated/` (asana, dynamics365, github, jira,
  openproject) had no script or CI check keeping them in sync with `generateWorkflow()` + the current
  vendor JSON, so they could silently rot. Added `scripts/src/gen-n8n-blueprints.ts`
  (`pnpm --filter @workspace/scripts run gen-n8n-blueprints`), which regenerates each example from the
  live (pure, deterministic) generator, wired into a new CI drift-check step mirroring the existing
  gen-vendors/gen-function-map pattern. Regenerated and committed the five examples, whose action/
  capability key order had drifted from alphabetical vendor-JSON ordering (same node graph — a
  formatting-only diff).

### Documentation

- **README rewritten to be audience-branched and plain-English-first.** The README
  used to open with "broker seam" / "n8n" / "Kubernetes" / "SAP" — engineer-first
  framing that reads as "not for me" to a non-technical charity ops director or SME
  owner. It now opens with one plain-English sentence of value, then three clearly
  labelled doors — **for small teams & charities**, **for enterprises**, **for
  engineers** — each a short paragraph in that audience's own language, linking to
  the right deep doc (`docs/SMALL-ORG-GUIDE.md`, `docs/ENTERPRISE-READINESS.md`,
  `docs/ARCHITECTURE.md` + `docs/READING-GUIDE.md`). All the existing technical depth
  (architecture, broker-agnostic design, self-host details) is kept, moved below the
  fold under "How OmniProject works" — nothing was deleted, only reordered and
  re-framed. The small-org quick-start section now also mentions the "We're a
  charity" one-click preset.

- **Speed / responsiveness / design-patterns review (`docs/archive/reviews/PERF-PATTERNS-REVIEW.md`).** A staff-engineering
  pass (155 files, 60 findings) for the 60-programme/200-project scale target. Verdict: no correctness bugs, but
  ~10 recurring patterns that turn O(1) into O(portfolio) — unbounded portfolio fan-out (200-way query storms),
  pure static derivations rebuilt per call, and React memos that never hit (fresh `useQueries` array refs). Most
  fixes are small/local; report only, remediation sequenced. Prioritized Top-15 by ROI included.
- **Whole-codebase clean-code audit (`docs/archive/reviews/CLEAN-CODE-AUDIT.md`).** A 1-for-1 review across all 519 source
  files (9 groups) — verdict **GOOD (B+)**: zero correctness/security defects, 15 medium + 52 low cleanliness
  findings, dominated by under-adoption of helpers that already exist. Flags two systemic risks to remediate
  (hand-rolled constant-time equality in 5 files; a few SPA mutation clients skipping the `res.ok` check) and
  a prioritized Top-20 fix list. Report only; fixes sequenced as follow-ups.

### Security

- **Re-audit (2026-07) of the newest surfaces — messy-data, dev-mode routes, report overrides,
  dashboards persistence/import, snapshots, safe-json seams** (see `docs/archive/reviews/SECURITY-AUDIT-2026-07.md`).
  One Medium fixed: the dashboard-file import seam (`lib/dashboard-file.readDashboardFile`, added after
  the #320 prototype-pollution hardening pass) parsed uploaded JSON with the **raw** `JSON.parse` instead
  of `safeParseJson`, leaving the untrusted-upload reviver un-applied at a new seam and contradicting the
  file's own docstring. Switched it to `safeParseJson` so `__proto__`/`constructor`/`prototype` keys are
  stripped at every depth before the object is reconstructed — restoring the "reviver at every untrusted
  seam" invariant. Regression tests cover the upload path (valid parse, invalid-JSON error, and a crafted
  pollution payload leaving `Object.prototype` clean). The messy-data feature, the dev-mode
  impersonation/entitlements/broker/messy routes, the report-overrides route, the snapshot Ed25519
  sign/verify + canonicalisation, and the remaining safe-json seams were reviewed and found sound
  (dev-only + real-admin gating + audit + prod-inertness; clamped/validated config; reads-only; no key
  leakage; no injection/IDOR/XSS). Lower-severity observations documented as accepted/follow-up.
- **Stateless scope-ownership on governance writes (closes the IDOR).** The programme/project governance
  PUTs no longer authorize by role *class* alone — they verify the caller actually **manages the named
  scope** by pulling their accessible project graph **live from the backend** (their own forwarded token,
  through the broker), so the backend's access control is the ownership oracle. A project is governable
  iff the caller can see it; a programme iff they have ≥1 visible project in it; a PMO-root who sees
  everything governs everything — all without OmniProject holding any user→scope state. The project
  ceiling now uses the project's **real** server-resolved programme (no client-supplied widening), and
  the check **fails closed** (403) if the backend is unreachable.
- **Hardened the feature-gating / governance authorization boundary** after a focused security + maturity
  pass on the newly-merged hierarchy (#284–#287). The pure resolver was already sound (monotonic
  narrowing, ancestor locks win); the fixes are at the write/enforcement layer: the parent **ceiling now
  excludes ancestor `forbid` locks** (a project can't `require` what its programme forbade); the
  governance PUTs **validate catalogue ids** (unknown ids rejected), **reject require∩forbid conflicts**,
  and **guard reserved keys** (`__proto__`/`constructor`/`prototype`) on scope ids; every governance
  mutation is now **semantically audited** (`governance.{org,programme,project}.update`); and the
  **report/methodology planes are enforced server-side** — a `forbid report:x` / `forbid methodology:x`
  is withheld from `/api/setup/reports` + `/api/setup/methodologies`, not just the admin table.
  `getJson` now surfaces the server error on a non-OK response instead of an opaque parse failure.

### Documentation

- **Human-auditability documentation pass.** Three new docs let a technical auditor or
  new engineer understand the whole system in one sitting — architecture, the broker
  seam, the data flows, and the key sequences — without reverse-engineering the code,
  with Mermaid diagrams and file citations cross-checked against the source:
  `docs/ARCHITECTURE.md` (stateless/zero-at-rest model, the layer cake, the broker
  seam, where config lives, the security spine, dev-mode gating — component + seam
  diagrams); `docs/SEQUENCES.md` (seven traced Mermaid sequence walkthroughs: auth/
  session establishment, a broker read through the single-flight→cache→provenance→
  messy(dev)→trace decorator chain, an optimistic-concurrency write-through, capability/
  field resolution as superset ∩ manifest, snapshot Ed25519 sign + offline verify,
  notification dispatch above the seam, and prod-inert dev-mode/messy-data gating); and
  `docs/READING-GUIDE.md` (a subsystem → entry-point-file map plus a glossary of the
  domain vocabulary). Linked from the README ("For engineers / auditors") and
  `docs/TECHNICAL.md`. Docs-only — no source changed.

### Added

- **Enterprise SSO made first-class: SAML 2.0 + SCIM provisioning runbook.** SAML now fails *loud, not
  silent*. A **partially-configured** SAML rollout (some `SAML_*` set but a requirement missing) previously
  looked simply "off"; it is now surfaced three ways — a one-time boot `warn` naming the exact missing env,
  a `samlStatus` object on `GET /api/auth/me` (`configured` / `partial` / `missing`), and, in production, a
  fatal boot issue via `checkRequiredEnv`. New pure, testable `samlConfigStatusFrom(env)` / `samlConfigStatus()`
  are the single source of that truth (the three hard requirements are `SAML_IDP_ENTRY_POINT`, `SAML_IDP_CERT`,
  and an ACS URL from `SAML_CALLBACK_URL` **or** `PUBLIC_URL`). A new regression test
  (`sso-role-parity.test.ts`) pins the contract that an IdP group resolves to **identical** OmniProject grants
  whether it arrives via an OIDC claim, a SAML assertion, or a SCIM group — all three funnel through the one
  `grantsFromClaims` resolver against the one role map. Added a full **`docs/SSO-SCIM.md`** provisioning **and
  deprovisioning** runbook (Okta / Entra / Google recipes, SP metadata, SCIM lifecycle, verification +
  troubleshooting) and a documented `SAML_*` section in `.env.example`. Additive throughout — OIDC, demo, and
  magic-link auth are untouched, and the SAML provider library stays a runtime-optional dependency.
- **Stakeholder register, risk register + RACI matrix (#93).** Phase 3 of the PM/PgM overlay extends the
  canonical field vocabulary with three governance concerns (145 fields, drift-guarded), each gated per
  backend and surfaced as a JSON screen. **Stakeholder register** — a new `stakeholder` field group +
  entity and `stakeholders` capability domain (stakeholderName, stakeholderRole, influence, interest,
  engagementLevel, commsCadence, engagementStrategy). **RACI matrix** — a new `raci` group + entity and
  `raci` domain (deliverable → Responsible/Accountable/Consulted/Informed, one Accountable per
  deliverable). **Risk register** — a new `risk` group that **extends RAID rather than duplicating it**:
  probability, riskExposure (P×I score) and responseStrategy ride the existing `raid` domain on the raid
  entity, flowing through the current `/raid` route. Three capability-gated screens (`stakeholders`,
  `risk-register`, `raci-matrix`) join the screen catalogue; demo data, capability-derivation tests and a
  governance demo-data guard bind the sample rows to the registry. OpenAPI `Capabilities` gains required
  `stakeholders` + `raci` booleans; regenerated fields/screens/openapi bundles + api-client/zod clients.
- **OTLP telemetry export, a Helm chart, and operations (HA/DR) docs — observability + ops for IT
  buyers.** Observability was trace-context/scrape-leaning; this makes it a real
  metrics-and-spans-over-OTLP story, all **additive and off by default**. (1) A new OTLP/HTTP **metrics
  exporter** (`lib/otlp-metrics.ts`) pushes the always-available in-process signals — RED
  (rate/errors/duration), broker-call latency, and **read-cache hit/miss** (now also surfaced on the
  Prometheus scrape) — to a collector on an interval, gated on the same `OTEL_EXPORTER_OTLP_ENDPOINT`
  as the existing span export (unset ⇒ nothing runs). Cumulative temporality, best-effort, never
  blocking a request. New `OTEL_METRIC_EXPORT_INTERVAL` (default 60 s, floor 1 s). (2) A **Kubernetes
  Helm chart** at `deploy/helm/omniproject` (Deployment/Service/Ingress/HPA/PDB/ConfigMap/Secret/
  ServiceAccount/optional PVC) for the stateless shell — hardened pod (non-root, read-only rootfs, drop
  ALL, no SA token), `/api/healthz` liveness + `/api/readyz` readiness probes, OTLP wiring off by
  default, and an HPA disabled until `REDIS_URL` is set (the single-replica SSE-fan-out caveat). (3)
  `docs/OPERATIONS.md`: horizontal scaling, HA (topology spread + PDB + probe semantics + graceful
  shutdown), DR/backup (config-only, zero-project-data-at-rest, RTO/RPO), and enabling telemetry.
  Guarded by a new `helm-guard` test (chart wires `BROKER_URL`, real probe paths, OTLP-off-by-default,
  empty `SESSION_SECRET`, hardened pod) and OTLP-conversion unit tests. No new write paths; nothing
  stored.
- **Per-country data residency & egress policy (#97).** The single-region, fail-closed residency guard
  now accepts a richer, validated **JSON policy** (`DATA_RESIDENCY_POLICY`) mapping each
  `region → { backends, egress }`, so a multinational (Compliance + CISO) can pin several jurisdictions in
  one deployment — each to its own broker backends **and** its own egress hosts. It adds a **second
  enforcement seam**: when a policy is active, *every* outbound hop (`assertEgressAllowed` — broker, IdP,
  FX, AI, logging) must target a host in an **allowed** region's egress allowlist, else it is refused with
  the existing `451 DataResidencyError` and a `data_residency.egress_block` audit event. Fail-closed
  throughout: an undeclared region, an unknown egress host, or an **invalid/unparseable policy** refuses
  everything (a policy the gateway can't read can't prove residency). Admins can dry-run a candidate policy
  against the exact validator via `POST /api/security/data-residency/validate` (admin + step-up, audited),
  and `GET /api/security/data-residency` now reports the active `mode` (`policy`/`env`/`off`) plus each
  region's backends/egress/allow verdict. The flat env pair (`DATA_RESIDENCY_ALLOWED`/`_MAP`) is unchanged,
  and with no policy set the whole layer is inert — the default single-region behaviour is preserved. See
  `docs/DATA-RESIDENCY.md`.
- **Proactive "what needs me" digest (opt-out).** The overworked PM/PgM lives in email/Slack/Teams, not
  in a dashboard tab — so the product now PUSHES a concise, role-aware roll-up of what actually needs them
  (at-risk amber/red projects, active blockers, overdue/slipping schedules, budget breaches), prioritised
  and bounded, to where they already are. A **pure** digest builder (`buildProactiveDigest`) derives it
  over the portfolio read model — deterministic, testable, and aggregates-only (it names the projects the
  recipient already governs, never task ids or detail). It dispatches through the existing notification
  seam: a new **`digest` notification kind** (in the kind registry) plus a **default route**
  (`assets/notification-routes/digest.json`) fan it out to email + team chat for the `manager` audience,
  reusing the generic dispatch/routing — no new egress path, no bypassed seam. The scheduled run mints the
  keyed, short-lived, viewer-roled `automation:proactive-digest` principal (same mechanism as health-watch
  / the exec digest), reads the portfolio read-only, and is audited. **ON by a safe weekly default**
  (`PROACTIVE_DIGEST_INTERVAL_HOURS=0` opts out; a fleet drives `POST /api/admin/proactive-digest/run` from
  external cron so it fires once), with configurable thresholds. A **healthy portfolio yields an empty
  digest that is skipped**, so "on by default" is never "noise by default."
- **Role-tailored persona dashboards — the "what needs me today" view (#103).** A busy PM has minutes
  between meetings and wants ONE screen answering "what needs me today", not another blank dashboard to
  build. Ships a catalogue of **preset dashboards**, one per role persona (head-of-projects /
  programme-manager / project-manager), each assembling **existing** widgets (portfolio health, status
  breakdown, trends, recent activity, counts) into a triage layout. Authored as JSON under
  `lib/backend-catalogue/assets/dashboard-presets/` with a schema + `gen-dashboard-presets` generator +
  generated catalogue (drift-guarded in CI) + a **preset-coverage guard** that keeps every preset's
  widget `type`s bound to real widgets — the same discipline as widgets/personas. On the Dashboards page
  an **"Apply a preset…"** picker mints a fresh dashboard from a preset (via the existing save path,
  keyboard-operable), and the empty state surfaces the role presets as one-click suggestions. Pure and
  read-only: presets read through the existing read-model widgets; no new write path to project data.
  Presets that need an entity the backend can't surface (e.g. programmes) are dropped automatically.
- **Progressive disclosure / role-aware navigation.** The primary sidebar (and mobile drawer) now leads
  with only the everyday overworked-PM surfaces — dashboard/what-needs-me, projects, reports, resources —
  while the heavy governance/config surfaces (Explore, Settings, Setup) move under a single collapsed
  **Advanced** area. That area is expanded by default only for the roles that own it (admin / PMO) and
  stays collapsed for plain PMs, who can still reveal it with an explicit toggle. Nothing is removed:
  every route still exists and deep-links resolve for authorised users — only the default *visibility* in
  the chrome changes, reducing cognitive load. The decision is a small, pure, data-driven helper in
  `lib/nav.tsx` (`navShelvesForRole` / `roleSeesAdminByDefault` / `partitionNavByGroup`, each with
  per-role unit tests), so the sidebar and command palette can never drift. The Advanced group uses a
  Radix `Collapsible` (a real `<button>` trigger) so it stays fully keyboard-operable and accessible.
- **Bundled-backends stress harness — every catalogue backend/broker/vendor-profile proven under stress.**
  A committed harness (`artifacts/api-server/src/broker/bundled-backends-stress.test.ts`) that ENUMERATES
  every bundled backend + broker from the catalogue (never a hardcoded list) and asserts, per definition:
  schema-validity via the catalogue accessor; capability↔transport consistency (no capability a transport
  can't serve, no zero-capability "no-purpose" entry, key format never resolves keyless for a live/database
  backend, broker set matches `brokersForTransport`, `statusVocabulary` maps only onto canonical statuses);
  that the demo-AS-vendor spoof (`applyVendorProfile`/`demoVendorFor`) gates the surface to each vendor's
  declared capabilities and never appears over real data or the dev broker; that `describeFields`
  reconciliation against the canonical `FIELD_REGISTRY` (including adversarial dupe/empty/garbage input)
  never crashes and flags unknown fields as gated passthrough; and that driving each vendor's demo read
  model through the messy-data transform (max intensity, several seeds) preserves row counts and never
  severs a row from its project. Findings are documented in `docs/archive/reviews/BUNDLED-BACKENDS-STRESS.md`. The pass
  found the bundled defs internally consistent (38 backends, 7 brokers) — no broken defs; two low-severity
  follow-ups are recorded.
- **Enterprise-readiness buyer-panel gap analysis (`docs/ENTERPRISE-READINESS.md`).** A new,
  evidence-grounded document aimed at a large multinational evaluating OmniProject as an overlay on
  Jira. It answers, per evaluation seat (CEO, Finance, Compliance, CISO, IT, Projects): what the seat
  cares about, what OmniProject **already delivers today** (every claim cited to a real file — e.g.
  the empty `lib/db` schema for zero-at-rest, `exec-pack`/`exec-digest` for the board pack, `programmes`
  EVM, `currency`/`fx-fallback` for multi-currency, `dual-control` for segregation of duties,
  `audit-chain`/`snapshot`/`signing` for tamper-evidence, `saml`/`scim` for SSO/lifecycle,
  `tracing` for OTLP export, `data-residency` for fail-closed region routing), and the concrete gaps to
  close. Includes the "keep Jira, sit on top" positioning, a TCO/ROI sketch vs enterprise PPM, a
  prioritised roadmap table (gap → owning seat → S/M/L effort → whether already in backlog), and a
  "what to build first" recommendation. Docs-only; no source or behaviour changed. Linked from the
  README documentation index as the "For enterprise buyers" entry point.
- **SME & charity copilot lenses + a discoverable small-org story.** Two new copilot personas —
  **Charity Programme Lead** (tuned to the shipped `grant-tracking` / `fundraising-pipeline` /
  `volunteer-roster` methodologies and grant/funder/donor/volunteer/impact keywords) and **SME
  Delivery Lead** (a lean small-team budget/capacity lens) — so a small org's questions no longer
  fall back to the enterprise PMO-analyst lens. Added a "Small teams, charities & self-hosters"
  section to the README linking `docs/SMALL-ORG-GUIDE.md`, and a new `docs/SME-CHARITY-FIT.md`
  audit confirming core value (connect a backend, projects/issues, reports, dashboards) stays
  free and that only prebuilt enterprise convenience is gated. Additive only — no enterprise
  feature was changed.
- **Cross-programme dependency & critical-path map (stateless report).** A new portfolio report derives,
  live from the read model, the cross-programme dependency graph — every `depends-on` link between work
  items, with the edges that cross a programme boundary flagged — and the **critical path across the whole
  graph**, reusing the shared CPM solver (`critical-path.ts`) rather than re-implementing the
  forward/backward pass. Durations come from start→due spans (dateless items floor to a day so chains
  still schedule); dangling references are dropped and cycles are surfaced rather than hung on. Rendered as
  a circular node-link diagram (dashed edges = cross-programme, red = critical) plus dependency and
  schedule tables. Pure derive-only over live rows — no new write paths, nothing stored. New pure lib
  `cross-programme-dependencies.ts` (+ Vitest), the `CrossProgrammeDependencies` renderer wired into the
  Reports page and renderer registry, and the `cross-programme-dependencies` report definition.
- **Capacity actuals vs plan (#102).** A new `capacityActuals` dashboard widget compares each resource's
  logged-time **actuals** (`issue.loggedHours`, summed per assignee) against their **plan/allocation** from
  the resource-capacity read (`assignedHours` / `availableHours` / `allocationPercentage`), surfacing
  over- and under-delivery per resource plus a portfolio roll-up (delivery %, variance hours). The
  derivation lives in a pure, derive-only lib (`lib/capacity-actuals`, banded `OVER_DELIVERED` /
  `ON_TRACK` / `UNDER_DELIVERED` / `NO_PLAN`) over the existing read model — no new write paths, nothing
  stored. The widget is entity-gated on `member`, so it's only offered when the backend surfaces resources.
- **Localisation coverage audit (`guard-i18n-coverage`).** A developer/CI tool that loads the base locale
  (English) plus every other operating language from the SPA i18n dictionary and reports coverage gaps:
  keys present in the base but **missing** or **empty** in a locale, and **orphan** keys a locale carries
  that the base no longer declares. It prints a per-locale coverage report with percentages and a summary.
  Deterministic, non-breaking exit behaviour: fully-covered locales make it a hard guard (a future
  untranslated key then fails CI); pre-existing gaps make it **warn-only** (reported, CI stays green,
  since English fallback keeps the app correct); orphan keys are always a hard failure. Wired as a CI step
  and documented in `docs/archive/reviews/I18N-COVERAGE.md`. Snapshot at introduction: fr/de/es each 30/31 (96.8%), one
  untranslated key (`nav.explore`) apiece — warn-only.
- **Messy-data generator (DEV MODE ONLY) — resilience stress-testing against imperfect data.** A dev-only
  broker read-decorator (`broker/messy-broker`) that passes the read model through a pure, deterministic
  imperfection transform (`lib/messy-data`) before the app sees it, so we can watch how resilient our
  reports/derivations/screens are to real-world dirt: nulls & missing fields, inconsistent enum vocab
  (`done` → `Done`/`COMPLETE`/`finished`), blank/whitespace strings, odd numbers (negative/zero/huge/
  number-as-string), currency chaos (`gbp`/`£`/`XYZ`), broken dates (invalid, reformatted, due-before-
  start), wrong types, long/unicode text, missing provenance, and duplicate ids across the set. Seeded
  (same seed ⇒ same mess), READS ONLY (never writes back; the mess lands on a copy), and **hard-gated to
  dev mode** (`messyDataArmed()` is false in production, where dev mode is itself off). Toggle it live —
  on/off, intensity, seed, per-gremlin — from the in-app **Messy data** dev control or the admin-gated,
  audited `POST /api/dev-mode/messy`; seed the boot default via `OMNI_MESSY_DATA` / `OMNI_MESSY_INTENSITY`
  / `OMNI_MESSY_SEED` / `OMNI_MESSY_GREMLINS`. The DEV MODE watermark shows a `messy` surface when armed.
- **Governance catalogue spans reports + methodologies + the 3-level UI.** The gated catalogue is now the
  union of feature modules, **reports** (`report:<id>`) and **methodologies** (`methodology:<id>`), each
  carrying a `kind`, so a PMO can mandate ("must use PRINCE2") or forbid ("must not use the EVM report")
  any of them through the same resolver. The SPA `FeatureGovernance` panel groups the org → programme →
  project policy editor by catalogue plane; `FeatureModulesAdmin` now covers the module toggles only.
- **Hierarchical feature-gating + governance — foundation (`lib/feature-resolution`).** The pure core of
  the org → programme → project model. Two strengths of policy:
  - **Soft narrowing** — each level may further *disable* (`core ⊇ org-approved ⊇ programme ⊇ project`).
    The org (admin) sets the approved superset: everything ON by default except features flagged
    `defaultOff` for a **safety/cost/storage** reason (now: `presence`, `predictivePrefetch`, `odata`,
    `integrations` — all *cost*), which need an explicit org opt-in.
  - **Hard governance** — `require` ("must use") and `forbid` ("must not use") mandates, authored through
    the business-ruleset engine's `hard` mode, which **lock** descendants: a higher scope wins, so a
    programme/PMO can mandate or ban a feature/methodology/report for every project beneath it and a PM
    cannot override it. Monotonicity holds — a lower level can never grant beyond its parent.
  `featureStatus()` surfaces `defaultOff`/`reason`; the resolver reports `blockedAt` + `locked`/`lockedBy`/
  `policy`. Pure, fully unit-tested (13 cases). Live wiring (scoped resolution + per-scope endpoints over
  the features ∪ methodologies ∪ reports catalogue) and the admin UI follow.

- **Benefits Realisation + CapEx/OpEx reports (stateless).** Two new reports that consume the E1/E2
  fields, each derive-only with nothing stored. **Benefits Realisation** (`lib/benefits` +
  `BenefitsRealisation`, gated on the `benefits` domain) rolls up planned-vs-actual benefit value,
  the realisation %, a risk-adjusted forecast (planned × confidence), and the RAG spread by status.
  **CapEx/OpEx** (`lib/capex` + `CapexOpex`, gated on `financials`) splits spend into capital vs
  operating (falling back to `expenditureType` + cost when no explicit split), rolls up by cost
  category, and derives the annual capital charge from each item's depreciation period. The 16 E1/E2
  fields are now **typed on `Issue`** (so reports read them with full types) and carried in the demo
  dataset. Pure roll-ups covered by unit tests + component tests.

- **Canonical field registry extended: benefits realisation + CapEx/OpEx (E1/E2).** Sixteen new
  fields in the canonical vocabulary (`assets/fields.json`, drift-guarded; 114 → 130). A first-class
  **`benefits`** group + a dedicated **`benefits` capability domain** (planned/actual benefit value,
  measure, owner, baseline/target, start/due, status, confidence) so a backend can carry benefits
  realisation without a full portfolio rollup; and the explicit **CapEx/OpEx split** under the
  existing `financials` domain (`expenditureType`, `capexAmount`, `opexAmount`, `costCategory`,
  `depreciationMonths` — complementing the existing `capitalised`/`costRate`/`billRate`). Wired
  through the registry → capabilities → field-manifest pipeline and the OpenAPI `Capabilities` type;
  a backend that exposes these fields now has them recognised as canonical (gated, reconciled) rather
  than dumped to custom-field passthrough. Docs in `FIELD-CATALOGUE.md`; capability-derivation tests
  added. (Typed `Issue` surfacing + the realisation/cost reports are the follow-up.)

- **Critical Path (CPM) report (stateless).** A new `lib/critical-path` solver runs the standard
  forward/backward pass over activity durations + precedence to surface the project's **critical
  chain**, each activity's **earliest/latest start-finish** and **total float**, and the overall
  project duration — detecting dependency cycles rather than hanging on them. The `CriticalPath`
  report derives durations from the live issues (start→due span, else estimate ÷ 8h) and reads
  precedence from the existing **blocks / depends-on** dependency overlay (volatile/exportable,
  never server-stored). Pure derivation: same issues + links ⇒ same schedule, nothing persisted.
  Capability-gated on `scheduling`; solver + mapping covered by unit tests + a component test.

- **Portfolio Roadmap report (stateless).** A cross-programme timeline derived entirely from the data
  already in the backend: each project becomes a bar spanning the earliest start … latest due of its
  work items, grouped into programme swimlanes (standalone projects sink to the bottom), with a month/
  quarter axis and a "today" marker. Nothing is stored — `lib/roadmap` infers each span on the fly and
  the same read model always yields the same roadmap. Projects with no dated work are reported in the
  footnote rather than silently dropped. Capability-gated on `scheduling`; pure derivation covered by
  unit tests + a component test.

- **Quantitative risk — Monte Carlo schedule/effort simulation (stateless).** A new enterprise-grade
  risk report (`lib/monte-carlo` + `components/reports/MonteCarloRisk`) that closes the
  "quantitative risk" EPM gap **without storing anything**: it derives a task list from the project's
  existing estimates and simulates thousands of runs on the fly, turning each single-point estimate
  into a right-skewed triangular (optimistic `e·(1−u)` … pessimistic `e·(1+2u)`). It surfaces the
  **confidence S-curve**, the **P50/P80/P90** vs the naive plan (showing the plan is usually only a
  ~P30–P40), the **plan-confidence %**, and a **tornado** of the tasks driving the variance. Controls
  for uncertainty and iteration count; a fixed seed keeps a view reproducible. Capability-gated on
  `scheduling`. Pure, deterministic-with-seed simulator covered by unit tests + a component test.

- **CycloneDX component SBOM + supply-chain docs.** CI now emits a full **CycloneDX** component SBOM
  (versions for CVE correlation, via Syft) alongside the existing licence inventory and the
  block-on-critical `pnpm audit`. New **`docs/SUPPLY-CHAIN.md`** documents what's in place and what's
  parked (cosign/SLSA image signing, a gitleaks gate — both needing an infra/policy decision), and
  **`docs/PARKED-DECISIONS.md`** consolidates every item from the enterprise/cybersec/SME-charity gap
  review that awaits a maintainer call (first-party backend, hosted deploy, mTLS/FIPS, licensing,
  i18n breadth, self-hosted font) so they can be reviewed together.

- **Compliance & assurance evidence pack (docs).** Procurement-facing artifacts that turn the
  existing (strong) security posture into review-ready evidence: **`COMPLIANCE.md`** maps implemented
  controls to **SOC 2 / ISO 27001:2022 / NIST CSF 2.0** with a shared-responsibility model;
  **`THREAT-MODEL.md`** is a STRIDE model over the gateway/broker trust boundaries;
  **`PRIVACY.md`** states the controller/processor position with an Article-30 ROPA template + a
  sub-processor inventory; **`ACCESSIBILITY-CONFORMANCE.md`** is a WCAG 2.1 AA ACR (VPAT-style),
  backed by the axe-core CI job and the keyboard-parity guard. Cross-linked from `SECURITY-AUDIT.md`.
  Documentation only; every claim maps to a shipped control. (Data map / DSAR / retention / backup /
  DR already live in `ENTERPRISE-OPS.md`.)

- **Latency-aware adaptive read-cache TTL.** With `READ_CACHE_ADAPTIVE=true`, the opt-in read cache
  tunes each broker method's TTL from its **measured** upstream latency (an EWMA recorded on every
  real miss, `broker/adaptive-ttl.ts`). Combined model: below `READ_CACHE_ADAPTIVE_THRESHOLD_MS` a
  method is "already fast" and isn't cached at all; above it,
  `TTL = clamp(READ_CACHE_MIN_TTL_MS, READ_CACHE_MAX_TTL_MS, factor × latency)` — so a slow rollup
  caches longer (where caching pays off) while a cheap list isn't made stale for little gain. `MAX`
  is the explicit staleness ceiling; cold start falls back to the baseline `READ_CACHE_TTL_MS`; each
  entry stamps the TTL chosen at fetch time so a later tuning never retroactively extends it.
  Surfaced in the dev-mode `brokerReads.cache.adaptive` posture (per-method latency + chosen TTL).
  Covered by unit tests (cold-start fallback, threshold gating, latency-scaling, MIN/MAX clamps, EWMA
  smoothing) and cache integration tests (slow method cached longer, fast method skipped).

- **Single-flight broker reads + a scaling guide.** Concurrent identical reads (same actor, method
  and args) now share **one** upstream call (`broker/single-flight.ts`) — so N users opening the same
  dashboard make 1 backend call, not N. It's **always on** and introduces no staleness (every
  coalesced caller gets the one live result), shields the backend's API rate limits from a thundering
  herd, and sits below the opt-in TTL cache (a cache hit never reaches it). The dev-mode debug bundle
  now reports `brokerReads` (single-flight `calls` vs `coalesced`, plus cache hits/misses). A new
  [`docs/SCALING.md`](docs/SCALING.md) captures the broader plan — invalidation-driven read cache,
  upstream-aware backpressure, N+1 reduction — and the frontend responsiveness backlog.

- **Read-ahead prefetch (two tiers).** A new `lib/prefetch` warms the project read-model into the
  React Query cache ahead of need. **Deterministic prefetch-on-intent is on for everyone**: hovering
  (after a short dwell, so a mouse-sweep doesn't fire) or keyboard-focusing a project card warms
  *that* project's issues, so opening it is instant — safe to default-on because it only fetches the
  one thing you're about to open, with React Query dedupe + `staleTime`. A second, **predictive
  (speculative)** tier — warming data you haven't asked for, e.g. every project listed on a page — is
  **opt-in, off by default**, behind a prominent **health warning** (it multiplies real broker calls
  to the customer's backend, so it can consume the rate limit and add backend load/cost) and the new
  `predictivePrefetch` feature module, so an operator can remove the toggle org-wide. Both tiers only
  ever warm read-model GETs the user can already see — never AI, a write, or a gated action. Covered
  by hook tests (deterministic focus/hover-dwell/cancel; predictive gating) and a settings-card test.
- **Consolidated security audit (`docs/SECURITY-AUDIT.md`).** A single, reviewer-facing map of the
  full security posture — authentication & sessions (sliding idle + absolute cap, step-up re-auth),
  RBAC + SCIM lifecycle, CSRF, the pluggable vault + config-at-rest crypto, the per-session broker
  HMAC/nonce seam, the tamper-evident audit chain + optional Ed25519 non-repudiation, the egress/SSRF
  guard and rate limiting — with a control-summary table, per-module pointers, configuration knobs,
  and an honest residual-risk section. Cross-references `AI-SECURITY.md`, `EGRESS-INVENTORY.md` and
  `COMPOSE-AUDIT.md`. Documentation only; no behaviour change.

- **Docker Compose correctness guard + audit.** A new parseable guard
  (`scripts/src/guard-compose.ts`, `pnpm --filter @workspace/scripts run guard-compose`, run in CI's
  `verify` job) checks the deployment-safety invariants `docker compose config` can't see: every
  `depends_on … service_healthy` target actually defines a **healthcheck**, every pulled image is
  **pinned** (no implicit `latest`), the production gateway runs **hardened** (no-new-privileges /
  `cap_drop: ALL` / `read_only`), and Traefik never exposes an **insecure dashboard**. The
  `deploy-lint` job now also validates the **load-test** compose and the **dev override layered on
  the standalone base** (previously only standalone + enterprise were parsed), and the load-test
  gateway gained a liveness healthcheck so the rig supports `--wait`. The full audit — topologies,
  what was verified, and the stateless/read-only rationale — is documented in `docs/archive/reviews/COMPOSE-AUDIT.md`.
  No correctness defects were found in the existing compose files; this locks that in against drift.

- **Live collaboration presence (Phase 2 UX polish — real-time).** A new opt-out **`presence`**
  feature module shows who else is on a work item and, advisorily, which field they're editing —
  over Server-Sent Events, so it's push-based with no polling. The work-item side-panel now carries
  presence **avatars** (coloured initials, name to screen readers) and a soft **"X editing…"** hint
  beside a field a collaborator has focused. Everything is **ephemeral and advisory**: presence is
  in-memory connection state (nothing at rest — a closed tab disappears), and a field "lock" is a
  soft, TTL'd hint to reduce accidental clobbering, **not** a gate. The **hard** guarantee stays the
  optimistic-concurrency token (`expectedVersion` / Issue.version): two concurrent saves still
  resolve by a 409 → refresh, never a silent overwrite — **no CRDT, no server merge**. Backend:
  `lib/presence-hub` (rooms → ephemeral peers, soft-TTL editing claims, broadcast) + `routes/presence`
  (an SSE stream + a heartbeat endpoint), drained on graceful shutdown and surfaced in the dev-mode
  debug bundle (`runtime-posture.json` → live rooms/connections). Frontend: `lib/presence`
  (`usePresence` room hook + pure `freshPeers`/`peerInitials` helpers) and a `PresenceAvatars`
  component. Covered by hub + route (real-app SSE) tests, presence hook/helper + avatars unit tests,
  and a side-panel integration test (a streamed peer surfaces an avatar + lock).

- **Swipe-to-dismiss the work-item panel (Phase 2 UX polish — mobile gestures).** A small,
  dependency-free swipe helper (`lib/use-swipe`) turns touch drags into cardinal-direction gestures
  (a pure, unit-tested `classifySwipe` with a threshold + off-axis restraint so a scroll or a lazy
  diagonal doesn't misfire, plus a `useSwipe` hook that ignores multi-touch). The rich side-panel now
  honours a **right-swipe to close** on touch. It is purely additive — the close button (mouse) and
  Escape (keyboard) still dismiss it, and touch events never fire on a non-touch device — so the
  both-ways rule holds and there's no desktop regression. Covered by `classifySwipe`/`useSwipe` unit
  tests and side-panel component tests (a right-swipe closes; a vertical scroll does not).

- **Recently-visited items in global search (Phase 2 UX polish — findability).** Opening a project,
  programme or work item now quietly records it, and the global-search overlay's idle state (no query
  yet) offers those **Recent** items as a one-keystroke way back — instead of a bare "Type to search."
  prompt. The recents are personal and ephemeral (per-browser `localStorage`, nothing sent to the
  server, capped at 8, de-duplicated newest-first), in keeping with the nothing-at-rest ethos. They
  reuse the search overlay's row rendering, routing and ↑/↓/Enter selection, so a recent is reachable
  by **mouse and keyboard** exactly like a live hit. Covered by pure-reducer + store unit tests, a
  side-panel recording test, GlobalSearch component tests, and a mouse-and-keyboard `recents` e2e.

- **User-selectable UI density via design tokens (Phase 2 UX polish).** A new per-user **Density**
  preference (Comfortable / Compact) joins the accessibility overlay (`lib/a11y-prefs`). It applies
  app-wide from a single design token: the document root carries `data-density`, and under
  `[data-density="compact"]` the Tailwind v4 **`--spacing`** token tightens to `0.2rem`, so every
  spacing utility (`p-*`, `m-*`, `gap-*`, `space-*`) shrinks at once — no per-component changes. Like
  the other personal prefs it is cached in `localStorage` for a flash-free first paint **and**
  persisted server-side per user (`sanitizeUserPrefs` validates the value, defaulting unknowns to
  `comfortable`), so an information-dense layout follows a person across devices on top of the
  company theme. The control is a paired Comfortable/Compact toggle (mouse + keyboard, `aria-pressed`)
  in the Accessibility settings card. Covered by store/`applyA11yPrefs` unit tests, an `A11yControls`
  component test, a backend sanitiser test, and a mouse-and-keyboard `density` e2e spec asserting
  `html[data-density]` flips against the demo backend.

- **Whole-app route-coverage acceptance smoke + drift guard.** A single Playwright spec now visits
  **every client route** (manifest in `e2e/routes.ts`) and proves each renders in a real browser
  against the demo backend — document `< 400`, the page paints its `<h1>` (not the error boundary or
  a blank chunk), and **no uncaught exception or unexpected 5xx**. It signs in once and reuses the
  session (fast + no rate-limit flakiness). A new **`guard-e2e-routes`** CI check parses `App.tsx`'s
  `path="…"` declarations and **fails if any route lacks an e2e entry** (or a manifest entry is
  stale) — so a new page can't ship without an acceptance smoke, the same way the other drift guards
  bind generated artifacts to their source. The acceptance webserver also disables the rate limiter
  (`RATE_LIMIT_DISABLED`, test-only) for deterministic runs.

- **Consistent skeleton loaders + reduced-motion awareness (Phase 2 UX polish).** Shared,
  content-shaped skeleton primitives (`SkeletonText` / `SkeletonRows` / `SkeletonCards`) replace
  ad-hoc "LOADING…" text on data surfaces: `DataState` now takes an optional **`skeleton`** node
  (behaviour-preserving — falls back to the text loader), and the editable grid adopts it. A new
  **`useReducedMotion`** hook (the union of the per-user `reduceMotion` preference and the OS
  `prefers-reduced-motion` setting) makes the skeletons render **static** under reduced motion —
  belt-and-braces with the CSS that already collapses animation/transition durations under both
  signals. Covered by hook + skeleton + DataState component tests.

- **Keyboard-first: one shortcuts registry + discoverable help (Phase 2 UX polish).** All keyboard
  shortcuts now live in a single source of truth (`lib/shortcuts`) that the **help overlay** renders
  from, so the cheatsheet can't drift from the real bindings. The overlay opens with **`?`** and via
  a new **visible header `?` button** (mouse parity), documents `⌘/Ctrl+K`, the new **`/`** search,
  `Esc`, the **G-chord** navigation and list keys, and closes with `Esc`. Fixed an inconsistency: the
  sidebar advertised a **`G+E`** (Explore) chord that was never wired — it now navigates. Covered by
  a registry unit test, the dialog test, and paired mouse + keyboard acceptance specs.

- **Optimistic edit + one-click Undo (Phase 2 UX polish).** Inline field edits in the **grid** and
  the **side-panel** now flow through a single shared writer (`useIssueFieldWrite`) and offer a
  **"Saved · Undo"** toast that reverts the change within the toast window. Undo is itself
  concurrency-safe — it re-issues the inverse write against the **latest** version, so it never
  clobbers a newer change (409 → refresh, never overwrite). The shared writer replaces the two
  near-identical bespoke commit paths (optimistic cache update + `expectedVersion` + error/409
  handling now live **once**); bulk grid edits intentionally skip the per-row Undo toast. Covered by
  hook + component tests and the editable-grid acceptance specs (mouse + keyboard).

- **Acceptance (end-to-end) test harness + keyboard/mouse parity gate.** A **Playwright** harness
  drives the **real built SPA in Chromium** against the gateway in **demo mode** (stateless, sample
  data, demo auth — no broker/backend), proving the product *behaves as intended* from the user's
  seat, not just that functions return the right value. Uses the environment's pre-installed
  Chromium (no download); `pnpm e2e` builds the SPA + gateway and boots one server serving both.
  Specs (`artifacts/omniproject/e2e/*.spec.ts`) cover sign-in, sidebar nav, **global search** and
  the **command palette** — **each journey written twice, a mouse path and a keyboard-only path**,
  because every affordance must be operable both ways. A new static **interactive-parity guard**
  (`guard-interactive`) fails CI when a non-interactive element carries an `onClick` without a
  keyboard path, and a **header Search button** gives global search a pointer trigger alongside `/`.
  Runs as a **separate CI job** so it never slows the fast `verify` lane.

### Fixed

- **SPA history-fallback 404 on every deep link (Express 5 `sendFile`).** With Express 5, the
  single-container server's `res.sendFile(absolutePath)` rejected with a "Not Found" (404) for **every**
  client-side route (`/login`, `/projects/:id`, `/programmes/:id`, …) when `STATIC_DIR` was given
  relative (as the e2e harness and the compose/k8s artifacts do), so only `/` worked — the whole
  acceptance harness was red behind it. The fallback now uses the reliable `res.sendFile("index.html",
  { root })` form. A new regression test (`spa-fallback-relative.test.ts`) exercises a **relative**
  `STATIC_DIR` — the pre-existing static-cache test masked this by using an already-absolute temp dir.

- **Report/derivation resilience to dirty data (messy-data stress pass).** Ran the dev-only messy-data
  generator at max intensity across six seeds over every pure derivation/report builder and hardened the
  worst gaps so a single dirty read-model row can no longer poison an aggregate: `buildExecHealth`
  (exec-pack) coerces the numeric health fields and normalises mixed-casing RAG; `completionRate`
  (roadmap) coerces `issueCount`/`completedCount` so a stringy/`NaN` count can't produce a `NaN` progress
  bar; `consolidateFinancials` (portfolio-finance) coerces every amount **before** currency conversion;
  `rollupByProgramme` (capacity-rollup) coerces resource hours/percentages; and `summariseBenefits`
  (benefits) now carries only the modelled fields into each report row so unmodelled dirty fields can't
  leak. A committed probe (`scripts/messy-resilience-probe.ts`) and per-lib regression tests lock this in;
  full findings in `docs/archive/reviews/RESILIENCE-FINDINGS.md`.
- **Logic & collision audit — valid data producing wrong results.** A per-definition audit for bugs
  where rows are individually **valid** but a consumer keys / dedupes / groups / sorts on a
  **non-unique** field. Two classes fixed surgically in the shared derivations:
  - **Roadmap issue-lookup keyed by bare `id` (identity collision).** `buildRoadmap` and its caller
    looked up each project's issues by bare `id`, so two projects sharing an `id` across different
    sources (`jira:p1` / `ado:p1`) read each other's issue spans and mis-dated a bar. Now keyed on the
    composite **`source:id`** via a new `roadmapKey` helper (falls back to bare `id` when no source is
    present, so single-source data is unchanged).
  - **Nondeterministic order for equal sort keys (unstable sort).** Added a unique final tiebreaker
    (the composite `projectId`, or the per-group `key` / `id`) to the exec pack severity sort, the
    roadmap lane/bar sorts, and the capacity / finance / income / benefits programme roll-ups plus
    `groupProgrammes`, so equal-metric rows sort **deterministically** regardless of input order.
  Programme grouping by `programmeId` is by-design and unchanged. A committed **collision stress harness**
  (`collision-stress.test.ts`, both SPA + api-server) auto-enumerates all **36** catalogue definitions
  and drives the derivations through empty / single / messy / **collide** datasets. Remaining items
  (assignee name-collision in the resource-load sandbox; a catalogue-`order` tiebreaker in the generated
  catalogues) are documented as follow-ups in `docs/archive/reviews/LOGIC-FINDINGS.md`.

- **SPA history-fallback 500 on deep links.** With a *relative* `STATIC_DIR`, the single-container
  server's `res.sendFile` rejected the relative path and returned **500 for every client-side route**
  (e.g. `/login`); only `/` worked. The index path is now resolved to absolute, so deep links and
  refreshes work regardless of how `STATIC_DIR` is given. (Caught by the new acceptance harness.)

- **Global search (UX-parity module).** A command-palette-style **cross-entity quick-find** over
  **projects, issues and programmes** from the existing read-model. **Keyboard-first** (open with
  `/` outside inputs, `↑`/`↓` to move, `Enter` to jump, `Esc` to close); selecting an issue routes
  to its project and **opens the rich side-panel** when that module is enabled. Ranking is a pure,
  unit-tested engine (exact > prefix > word-boundary > substring; projects ahead of issues then
  programmes on ties); issues are fetched per project only while the overlay is open. Shipped as the
  optional UI-only **`globalSearch`** feature module (gated by `useFeatures`); rendered once at the
  app shell. `components/search/GlobalSearch`, `lib/global-search`.

- **Rich side-panel (UX-parity module).** A **slide-over work-item detail panel**: a quick read-out
  of the item's fields (**availability-gated** — only what the backend surfaces and the admin/PMO
  kept), **inline edit** of the common fields (status, priority, assignee, due date) **through the
  existing issue-update endpoint with the optimistic-concurrency token** (`expectedVersion` =
  `Issue.version` / OpenProject `lock_version`; a concurrent change returns **409** and the panel
  refreshes instead of clobbering, optimistic-with-revert), and the item's **recent activity** when
  the backend surfaces it. Opened from anywhere via a small side-panel store (the editable grid
  gains a per-row "open details" affordance when enabled); rendered once at the app shell. Shipped
  as the optional UI-only **`sidePanel`** feature module (gated by `useFeatures`).
  `components/sidepanel/IssueSidePanel`, `lib/side-panel`.

### Changed

- **One SSE framing helper (clean-code, no behaviour change).** The notification, presence and
  admin-broker-log streams each hand-wrote the same Server-Sent-Events boilerplate — identical
  headers, the `ready` frame, the `event:/data:` writer, the keepalive ping and the close cleanup.
  That triplication is now a single `lib/sse` (`openSse` + `keepAlive`): each route shrinks to its
  actual job, and the wire-format details (e.g. `no-transform`, guarded writes after the socket
  closes) live in one tested place. Covered by `lib/sse.test.ts`; the existing stream tests are
  unchanged.

- **Whole-repo test coverage + dev-mode breadth (iteration 1).** Two packages' tests were never
  executed in CI — **`@workspace/backend-catalogue`** (field/view/vendor registries) and
  **`@workspace/api-client-react`** — so the verify job now runs both. The hand-written
  **`custom-fetch`** wrapper (the one non-generated piece of the API client: base-URL, bearer-token
  and snapshot-interceptor seams plus all response parsing / error shaping) gains a full test
  suite, and the shared **registry generator engine** (`gen-registry` `loadGroup`/`emitRegistry`)
  is now covered. The **debug bundle** also gains **`runtime-posture.json`** — a non-secret snapshot
  of the governance posture (AI provider + guardrails, audit level, STT, licence and per-capability
  surface/store) so a repro carries the policy context, not just the data (verified secret-free).
  Coverage is being raised **iteratively** — this lands the missing test execution + the
  highest-value gaps first.

### Fixed

- **Config snapshot / export now carries the new presentation config.** The snapshot (Setup →
  Backup/Restore, and the `config.json` inside the **debug bundle**) was a curated subset that had
  not kept pace with the recent modules — it omitted **`disabledFeatures`** (feature-module opt-out),
  **`hiddenFields`** (admin/PMO field-visibility curation), **`savedViews`** and **`dashboards`**.
  These are portable, secret-free presentation config, so they now ride the snapshot/export and
  round-trip on restore — making "save custom screens to the bundle" actually travel with a
  deployment. The **debug bundle** also now includes **`feature-modules.json`** (the optional-module
  enabled/loaded/needs-restart status), so a repro shows the exact module set that was active.

### Added

- **Custom dashboards (UX-parity module).** A **dashboard builder**: compose **named dashboards**
  from a **widget catalogue** — portfolio health, portfolio trends, recent activity, project/programme
  counts and a status breakdown — then add / remove / **reorder** widgets and set each one's
  **column span** (1–3 on a responsive grid). Every widget reads through the **existing read-model**
  (portfolio, projects, programmes, activity); the surface adds **no new write paths** to project
  data. Entity-gated widgets (e.g. programme count) are only offered when the backend can surface
  the entity. Dashboards are **shared, customer-level** presentation config persisted via
  `GET/PUT /api/dashboards` to **`settings.dashboards`**, which **rides the config-bundle export** —
  so a team's dashboards travel with the deployment (any authenticated user can build/switch; never
  project data). Shipped as the optional UI-only **`dashboards`** feature module; the primary nav
  gains a feature-gated **Dashboards** item. Unknown widget types (e.g. one removed in a later
  version) degrade to a placeholder rather than breaking a saved dashboard. `pages/Dashboards`,
  `lib/dashboards`, `components/dashboard/widgets`, route `/dashboards`.

- **My Work / Inbox (UX-parity module).** A personal landing surface with two tabs: **Assigned to
  me** — every work item assigned to the current user **across all projects**, grouped by status
  (matched on session `sub` / `email` / `name`, read through the existing per-project issue
  endpoints, no new write surface) — and an optional **Inbox** wired to the existing **notification
  SSE stream** (`/api/notifications/stream` via `lib/live-events`): new events accumulate live,
  newest-first, with client-side dismiss, and degrade gracefully to empty when nothing is wired.
  Shipped as the optional UI-only **`myWork`** feature module; the primary nav gains a **My Work**
  item that hides when the module is disabled (`NavItem.requiresFeature` + `useVisibleNavItems`
  feature-gating, alongside the existing entity gating). `pages/MyWork`, route `/my-work`.

- **Saved views (UX-parity module).** Save a **named view** — visible columns + sort (+ filters /
  grouping captured in the model) — and switch between them. Scoped to a surface (the editable
  grid first): pick a view to apply its column set + sort, **Save view** to name the current state,
  or delete one. Views are **shared, customer-level** presentation config persisted via
  `GET/PUT /api/views` to **`settings.savedViews`**, which **rides the config-bundle export** — so a
  team's views travel with the deployment (any authenticated user can save/switch, like shared
  filters; never project data). Shipped as the optional UI-only **`savedViews`** feature module
  (gated by `useFeatures`). The grid gains sortable column headers and applies the active view's
  column subset/order. `lib/saved-views`, `components/grid/SavedViewsBar`.

- **ADR 0002 — language choice** (`docs/adr/0002-language-choice.md`). Records the decision to keep
  **TypeScript across the whole first-party codebase** (the end-to-end shared contract types and the
  I/O-bound, zero-at-rest workload make it the right fit) and to treat the **broker seam as the
  sanctioned polyglot boundary** — brokers/sidecars below it may be written in any language that
  speaks the HTTP/JSON contract, and a CPU-bound need (none today) would be met by a sidecar/WASM
  behind the seam rather than by fragmenting the gateway's type system.

- **Editable data grid with bulk inline edit (first UX-parity module).** A spreadsheet-style grid
  of a project's work items: **click-to-edit** cells (text / select / date / number by field type),
  **Enter** to commit / **Escape** to cancel, **multi-row select + bulk-apply** one field value to
  every selected row. Columns are **keyed by canonical field keys and gated by availability**
  (superset ∩ backend − curation), so the grid shows exactly the editable fields the backend
  supports and the admin/PMO kept — this is where deep per-column availability gating lands. Every
  write goes **through the broker** with the **optimistic-concurrency token** (`expectedVersion` =
  `Issue.version` / OpenProject `lock_version`); a concurrent change returns **409** and the grid
  refreshes instead of clobbering (optimistic update with revert-on-error). Shipped as an
  **optional feature module** (`grid`) — the feature registry now supports **UI-only modules** (no
  backend route), listed + toggleable via `GET /api/features` and gated in the SPA by
  `useFeatures`. Surfaced as a **Board | Grid** view toggle on the project page when enabled.
  `components/grid/IssueGrid`. *(The remaining UX-parity modules — saved views, My Work, dashboard
  builder, side-panel, search — follow as separate feature-module PRs.)*

- **Admin/PMO field-visibility curation (Phase 1 UX).** On top of backend availability (superset ∩
  manifest-or-capabilities), an **admin OR PMO** can now HIDE available-but-unwanted fields from
  view. The availability resolver returns the full picture — `{ source, available (full backend
  set), hidden (curation in effect), fields (net = available − hidden), tables, relationships }` —
  and subtracts the curation **fresh on every call** (the backend layer is cached per backend kind,
  but a curation toggle takes effect at once). Curation can only **hide** what's available, never
  reveal what the backend lacks. It persists to **`settings.hiddenFields`**, which **rides the
  config-bundle snapshot/export**, so the curated view travels with the deployment (joining
  `screenLayouts`, which already persists drag-customised screens to the bundle). Endpoints:
  `GET/PATCH /api/availability/curation` (gated to admin or pmo). SPA: a **Field visibility** panel
  in Settings, a `useAvailability` hook and a `fieldVisible(...)` helper for renderers to gate UI.
  `lib/availability`. *(Deep per-column gating in the data grid lands with the table module.)*

- **Backend schema manifest + availability resolver (`describeSchema` / `GET /api/availability`).**
  A new **optional** broker method `describeSchema` returns a manifest — `{ tables, fields,
  relationships, populated }` — and a gateway **availability resolver** computes what a backend
  *actually* surfaces as **`superset ∩ (manifest, else capability flags)`**. **Scope:** the manifest
  (and "surface only what is *populated*") applies **only when a backend owns its schema** — in
  practice OmniProject's own stateful self-host DB. Every ordinary SaaS backend (the
  stateless-overlay default) implements no `describeSchema`: data stays in the vendor and
  availability is governed by the existing **static capability flags**, so the resolver **falls back
  cleanly** (conformance-tested). `GET /api/availability` returns `{ source: "manifest" |
  "capabilities", fields, tables, relationships }` (cached per backend kind, short TTL); the SPA gets
  a `useAvailability` hook. Admin/PMO view-curation (Phase 1) layers on top. `lib/availability`.

- **Superset enforcement + growth — the field registry is now a vendor-extensible, CI-enforced
  superset.** Two halves:
  - **Growth.** A backend descriptor may declare an optional **`fields[]`** array (each validated
    against `field.schema.json`); `gen-fields` merges them into the canonical superset
    (`fields.generated.ts`), deduping by key — first definition wins, and a redefinition with a
    *conflicting* type/group is a hard error. So adding a vendor whose API exposes a new field
    grows the superset by construction.
  - **Enforcement.** A new **`guard-superset`** CI step fails the build if any backend's
    **`fieldKeys[]`** (the canonical fields it references) is not in the superset — i.e. every
    backend's field set, OpenProject included, must be a strict **subset** of the superset. The
    superset can only ever be ⊇ every backend; an orphan reference or typo fails CI.
  - Both halves share one `loadSuperset` helper (base ∪ vendor contributions) so the generator and
    the guard can never disagree.
- **Field `entity` tag** — `field.schema.json` / `FieldDescriptor` gain an optional **`entity`**
  property (default `issue`) naming the canonical entity (table) a field belongs to. No change to
  existing fields; this is the grouping key the forthcoming superset-native self-host-DB schema
  generator uses to place each field as a column on the right table.

- **Feature modules — optional backend modules with true lazy loading (Phase 0 of the modular
  UX epic).** Optional, self-contained backend modules can now be switched off so a customer never
  loads (or pays the resources for) code they don't use. A registry (`lib/feature-modules`) reaches
  each module only through a dynamic `import()`; the mount step runs that import **only for enabled
  modules**, so a disabled module's route chunk is never loaded at startup (esbuild **code-splitting**
  is enabled, putting each behind its own chunk). It's an **opt-out** model — everything is on by
  default; disable by id via `DISABLED_FEATURES=odata,integrations` (env) or `settings.disabledFeatures`
  (admin, persisted to the config bundle so the chosen module set travels with the deployment). A
  `requireFeature(id)` gate also **404s a module the moment it's disabled at runtime** (enabling one
  that was off at startup needs a restart — surfaced honestly as `needsRestart`). `GET /api/features`
  lists every module's `{enabled, loaded, needsRestart}`; the SPA gets a `useFeatures` hook (for
  lazily gating optional UI) and an **admin "Feature modules" panel** in Settings to toggle them. As
  proof, the **OData/BI** and **integration-helper** routes are migrated to lazy feature modules;
  more migrate in follow-ups. This is the foundation the UX-parity modules (table bulk-edit, saved
  views, My Work, dashboards, side-panel, search) build on.

- **Multi-provider OIDC sign-in — a branded button per provider (Google, Microsoft, …).** The OIDC
  relying party moves from a single issuer to a **provider registry** (`lib/oidc`). Two ways to
  configure, combined: the **legacy single** `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` /
  `OIDC_CLIENT_SECRET` still works unchanged (it becomes the provider `default`); and **named
  providers** via `OIDC_PROVIDERS=google,microsoft` with per-id env (`OIDC_GOOGLE_ISSUER_URL`,
  `OIDC_GOOGLE_CLIENT_ID`, … plus optional `_SCOPE` / `_AUDIENCE` / `_LABEL`). Each configured
  provider renders its own **"Sign in with &lt;label&gt;"** button on the login screen. `GET
  /api/auth/login?provider=<id>` selects the provider (default = the first/legacy one); the signed
  flow cookie carries the provider id so the callback verifies the ID token against the **same**
  provider (per-provider issuer/audience/JWKS, through the `jose` `verifyIdToken` seam). A public,
  secret-free `GET /api/auth/providers` lists `{id, label, kind}` for the SPA. `state` + S256 PKCE
  + nonce binding, the per-IP `loginLimiter`, and the SSRF guards are all preserved; the discovery
  cache is now keyed per issuer so providers don't clobber one another. Backward-compatible: an
  existing single-OIDC deployment is unaffected (one provider, one button). Tests run without
  network (mocked discovery/JWKS).

- **Generic OAuth 2.0 (Authorization Code + PKCE) sign-in for non-OIDC providers (e.g. GitHub).**
  GitHub and similar issue opaque access tokens and expose identity via a userinfo endpoint rather
  than a signed ID token, so they can't use the OIDC relying party. This adds the sibling path
  (`lib/oauth2`): authorize → exchange the code (with the PKCE verifier) for an access token → call
  the provider's userinfo endpoint → map the JSON fields onto a session user → mint the **same**
  signed+sealed session cookie every other auth path uses (`setSession`). **Off by default**;
  enabled only when `OAUTH2_AUTH_URL` / `OAUTH2_TOKEN_URL` / `OAUTH2_USERINFO_URL` /
  `OAUTH2_CLIENT_ID` / `OAUTH2_CLIENT_SECRET` are all set (scope via `OAUTH2_SCOPE`; userinfo field
  mapping via `OAUTH2_USERINFO_{SUB,NAME,EMAIL,ROLES}_FIELD`, with sub/id/login fallbacks so GitHub
  works out of the box). Security: `state` + S256 **PKCE** binding to the browser flow, the strict
  per-IP **`loginLimiter`** on `GET /api/auth/oauth2/login`, and **SSRF-guarded** token/userinfo
  fetches (`assertSafeOutboundUrl`). The userinfo role/group field flows into the **same role-map**
  as OIDC claims. A **GitHub preset** is added to `lib/idp-presets` (the preset model gains a
  `kind: "oidc" | "oauth2"` discriminator + explicit `endpoints` for non-OIDC providers), surfaced
  in the setup wizard, and a "Sign in with OAuth2" button appears on the login screen when enabled.
  Endpoints: `GET /api/auth/oauth2/login` + `GET /api/auth/oauth2/callback`. Tests run without
  network (injected fetch). *(This is OmniProject acting as an OAuth2 **client**; it is not an
  authorization server.)*

- **Optional self-host database backend — design doc** (`docs/SELF-HOST-DB.md`). The **non-preferred**
  stateful path for those with no existing PM tool: a **customer-owned Postgres backend BELOW the
  broker seam** (the gateway stays stateless/zero-at-rest — the DB is just another backend the broker
  routes to), with an **OpenProject-compatible schema** derived from the canonical contract /
  `FIELD_REGISTRY` (so data is portable to/from real OpenProject — `Issue.version` maps directly onto
  OpenProject's `lock_version`). Documents the field/entity mapping, the docker-compose shape, the
  migration/portability path, and a hard responsibility boundary (the customer owns
  governance/backup/security/HA/updates). Implementation deferred to follow-up PRs pending sign-off.

- **Starter template packs for charities/SMEs.** Three ready-made "ways of working" shipped as
  methodology JSON bundles (the existing pack format/importer): **Grant tracking** (funder-grant
  lifecycle prospect→close with phases, baselines and funder reporting), **Volunteer roster** (a
  WIP-limited shift board), and **Fundraising pipeline** (donor pipeline with pipeline-value
  reporting). Each validates against the methodology schema and appears in the methodology picker;
  no new runtime code. `lib/backend-catalogue/assets/methodologies/`.

- **Magic-link / email-OTP sign-in (passwordless; charity/SME with no IdP).** A one-time email
  link mints the same signed session cookie as every other auth path. **Off by default**, and only
  available when neither OIDC nor SAML is configured (real SSO always wins): enable with
  `MAGIC_LINK_ENABLED=true`. The token is a **sealed (AES-256-GCM, tamper-evident) `{email, exp,
  jti}`** (no server-side secret); **single-use** is enforced via a `jti` marker in the
  shared-state seam (fleet-wide on Redis). Endpoints `POST /api/auth/magic/request` (rate-limited
  by `loginLimiter`; never leaks whether an address exists) and `GET /api/auth/magic/verify`. Email
  **delivery is pluggable and the operator's responsibility** — the default sender logs the link
  (dev mode returns it for testing); wire an SMTP relay / the notification egress for real sending.
  The login screen shows an "Email me a sign-in link" form when enabled. `lib/magic-link`.

- **Workspace-login wizard — "Sign in with Google / Microsoft" presets (charity/SME).** Guided
  presets over the existing OIDC relying party (no new protocol): a catalogue (Google Workspace,
  Microsoft Entra/M365, bundled Authentik, generic OIDC) giving the operator the issuer URL
  template, the exact env to set (`OIDC_ISSUER_URL`/`CLIENT_ID`/`CLIENT_SECRET`), the redirect URI,
  and how each provider exposes group claims for role mapping. Surfaced on `GET /api/setup/idp`
  (`presets`) and in the setup wizard's IdP step. Removes the "stand up an IdP" barrier — most
  charities/SMEs already have Google Workspace or M365. No secrets stored (the operator creates
  the OAuth client in their console). `lib/idp-presets`.

- **DSAR evidence report (admin, one-click).** `GET /api/security/dsar?sub=&email=` assembles —
  from live gateway state only — an auditor-ready "what do we hold/process for subject X" report
  (JSON + human-readable summary, `lib/dsar`). Consistent with zero-at-rest it reports references
  and locations, never copies: what is **not retained** (project data, session claims, role
  derivation, AI content); what the gateway **does** hold for the subject (SCIM record if SCIM is
  on, a session-revocation mark, content-free provenance-ring references); where the data
  **actually lives** (connected backends, origins only); and the **audit-chain anchor** to verify
  the subject's SIEM slice. The request is itself audited. See `docs/ENTERPRISE-OPS.md` §2.

- **Scheduled executive digest (PM-domain).** A periodic, read-only portfolio roll-up dispatched
  over the existing notification seam, so execs who never open the app still get the summary on
  their channel. Stateless-safe: the run mints a short-lived, keyed, viewer-roled **autonomous
  principal** (`exec-digest`, the health-watch mechanism) — no human session, no stored token —
  and the summary carries only aggregates (RAG counts, worst schedule/budget variance, blockers),
  never project detail. Trigger with `POST /api/admin/digest/run` (admin; for a fleet, fire it
  from an external scheduler / the broker so it sends once), or set `EXEC_DIGEST_INTERVAL_HOURS>0`
  for an in-process timer on a single instance. Off by default.
- **Stage-gates / governance approval workflows — design doc** (`docs/archive/design/STAGE-GATES-DESIGN.md`).
  Records why this is design-first: maker-checker can't replay a *brokered* write under
  zero-data-at-rest (the user's backend token is never stored), so gating brokered plan/baseline
  changes needs an approve-then-reissue flow; gating *gateway-side* governance changes
  (ruleset/methodology) slots into `dual-control` cleanly. Implementation deferred to its own PR.

- **AI governance + prompt DLP (opt-in, lean by default).** Layered on the single model-egress
  chokepoint (`lib/ai` `aiChat`), all OFF unless configured (`lib/ai-governance`):
  - **Prompt DLP redaction** (`AI_DLP_REDACT=true`) — masks emails, card numbers, API keys /
    bearer tokens and long phone numbers in prompt content **before** it leaves the gateway.
  - **Per-role model allowlist** (`AI_MODEL_ALLOWLIST="role=modelA|modelB,role2=*"`) — an
    out-of-allowlist model is refused (403); unlisted roles stay unrestricted.
  - **Per-scope token budget** (`AI_TOKEN_BUDGET` over `AI_BUDGET_WINDOW_HOURS`, default 24) — a
    soft cap per scope (the user `sub`/team), counters in the shared-state seam (fleet-wide on
    Redis); over budget ⇒ 429. Token counts are approximate (chars/4) — a cost signal, not a biller.
  - Admin surfaces: `GET /api/ai/governance` (policy) and `GET /api/ai/usage` (per-scope
    chargeback this window). The AI routes pass a per-request scope (`sub`) + role.

- **Shared-state seam (opt-in, Redis-backed) — the per-replica registries can now share fleet-wide
  (roadmap §2).** `lib/shared-state` is an opt-in async KV that's in-process by default and
  Redis-backed when `REDIS_URL` is set, mirroring the rate-limit / broker-log pattern: `ioredis`
  is a runtime-optional dynamic import (lean by default — undeclared dep, one-time warning + safe
  in-process fallback if absent). First adopter: the **maker-checker proposal queue**
  (`lib/dual-control`) now lives in the seam, so a proposal raised on one replica is approvable on
  another. `sharedStateMode()` (`in-process | redis`) is reported on the admin profile status. The
  concurrent-session cap (sync hot path) and audit-chain head remain per-replica for now — see
  `docs/TECH-DEBT-AND-ROADMAP.md` §2 for the opt-in path.

- **Data residency / region routing (opt-in, fail-closed).** A regulated deployment can now pin
  work to a region: every configured broker endpoint is tagged with a region
  (`DATA_RESIDENCY_MAP="urlPrefix=region,…"`), the deployment declares the allowed region(s)
  (`DATA_RESIDENCY_ALLOWED`), and a call that would route to an out-of-region — or
  region-undeclared — endpoint is **refused with `451` and audited** (`data_residency.block`)
  *before any bytes egress*. Enforced at `webhookPool()`, the single resolver every outbound
  broker call passes through. **Off by default** (no `DATA_RESIDENCY_ALLOWED` ⇒ no checks);
  fail-closed when enabled. Admin status at `GET /api/security/data-residency` (endpoints shown as
  origins, secret webhook paths redacted). See `docs/DATA-RESIDENCY.md`.

- **SAML 2.0 SSO (optional, alongside OIDC).** The gateway now also runs as a SAML Service
  Provider for IdPs/procurement that mandate SAML. SP-initiated flow `GET /api/auth/saml/login`
  → IdP → signed assertion POSTed to the ACS `POST /api/auth/saml/callback` → the same signed
  httpOnly session cookie. The assertion's group attributes feed the **same role-map** as OIDC
  claims, so group→role assignment is identical across both protocols. SP metadata at
  `GET /api/auth/saml/metadata`; `/api/auth/me` reports `samlConfigured` and the login screen
  offers a "Sign in with SAML" button when enabled.
  - **Install-on-demand dependency.** `@node-saml/node-saml` is *not* a declared dependency —
    a default `pnpm install` and the CI `--frozen-lockfile --ignore-scripts` install never pull
    it, so OIDC/demo/charity deployments stay lean (mirrors the optional Redis rate-limit store).
    It's dynamically imported only when `SAML_*` env is set; configured-but-not-installed logs a
    one-time warning with the install command and leaves SAML unavailable (OIDC/demo unaffected,
    never a boot crash). Enable: `pnpm --filter @workspace/api-server add @node-saml/node-saml`.
  - Config: `SAML_IDP_ENTRY_POINT`, `SAML_IDP_CERT` (PEM or base64-of-PEM), `SAML_CALLBACK_URL`
    (or derived from `PUBLIC_URL`), plus optional `SAML_SP_ENTITY_ID` / `SAML_AUDIENCE` /
    `SAML_EMAIL_ATTR` / `SAML_NAME_ATTR` / `SAML_GROUPS_ATTR` / `SAML_WANT_RESPONSE_SIGNED`.
    Assertions are always required signed. Honest scope: SAML asserts identity for RBAC but does
    not mint a per-user backend bearer (use OIDC where per-user backend tokens are needed).

### Security

- **Crypto hardening — `jose` for OIDC ID-token verification + HKDF key derivation.** Two changes,
  both reducing reliance on hand-rolled crypto without expanding the trusted surface:
  - **ID-token verification now runs through `jose`** (a well-reviewed, widely-audited JOSE library)
    behind the unchanged `verifyIdToken` seam (`lib/jwks`), replacing the hand-rolled signature
    verification. The security policy stays in our hands: the **asymmetric-only algorithm allowlist**
    (RS/PS/ES — no `HS*`, no `none`, so `alg`-confusion and unsigned tokens are rejected before any
    key is consulted) and the **SSRF guard** on the issuer-supplied `jwks_uri` (we fetch the keys
    ourselves through `assertSafeOutboundUrl` and hand jose a *local* key set, so jose performs no
    unguarded outbound request). `jose` is the first runtime crypto dependency; it is pure-ESM and
    bundles into the existing build. Added tests cover a known-good RS256/ES256 token, and rejection
    of tampered, alg-confusion (HS256-signed-with-the-public-key), expired and wrong-audience tokens.
  - **Symmetric key derivation moved from `SHA-256(secret)` to HKDF-SHA256** (`crypto.hkdfSync`, no
    new dependency) via `deriveKey(secret, info)` in `lib/crypto-keys`, with a domain-separation
    `info` label so the same secret can never yield a colliding key across uses. The **session cookie**
    now seals under HKDF — **backward-compatible**: new cookies carry a `v2.` prefix, while cookies
    sealed by an earlier release (`v1.`, legacy SHA-256) are still opened, so upgrading does not log
    everyone out (they migrate to `v2.` on their next login/refresh). The opt-in **broker PSK** is
    deliberately **left on the legacy derivation**: its `p1.` wire format is a published contract
    mirrored by external broker implementations (the reference blueprint), so changing its KDF would
    be a coordinated wire-format break rather than a drop-in hardening — and it keys off a *separate*
    high-entropy secret (`BROKER_PSK`), so there is no cross-domain key-collision that HKDF would fix.

- **Non-repudiation: optional Ed25519 signing of the audit + provenance anchors (`lib/signing.ts`).**
  The keyed-MAC chains are tamper-*evident* (a key-holder can detect alteration); signing the
  hash-linked chain TIP with a private key only the gateway holds makes the record
  *non-repudiable* — anyone with the published public key can confirm the gateway attests to that
  tip, and the hash links extend the attestation over the whole history. Opt-in via
  `SIGNING_PRIVATE_KEY` (Ed25519 as PEM, base64 PKCS#8 DER, or a base64 32-byte seed); **off by
  default** (no key ⇒ unsigned anchors, exactly today's behaviour). The public key + status are at
  `GET /api/security/signing`; signed anchors at `GET /api/security/audit/anchor` and
  `GET /api/provenance/anchor`; offline verification via `verifyAuditAnchor` /
  `verifyProvenanceAnchor`.

- **Auth/abuse hardening from the pentest pass (the four deferred items, now shipped).** Each is
  independent and self-contained:
  - **Login rate-limit.** A strict, per-IP `loginLimiter` (default 30 / 15 min, tunable via
    `AUTH_RATE_LIMIT_MAX`, honours `RATE_LIMIT_DISABLED` and the shared-Redis store) is applied to
    `GET /api/auth/login` and `GET /api/auth/step-up` at the router mount — throttling brute-force /
    flow-cookie spam ahead of the general `apiLimiter`.
  - **OIDC `nonce`.** Login/step-up now mint a `nonce`, bind it into the authorization request and
    the flow cookie, and the callback rejects (401) any ID token whose `nonce` claim doesn't match —
    so a token replayed/injected from a different flow can't establish a session.
  - **SSE deprovision re-check.** The notifications stream's 25 s keepalive now re-checks
    `isDeprovisioned(req)` each tick and tears the connection down (emitting a `revoked` event) the
    moment a SCIM `active=false` lands — a long-lived stream no longer outlives its revocation.
  - **CSP `nonce` (defence-in-depth).** Each response mints a per-request nonce added to
    `script-src` (exposed on `res.locals.cspNonce`). `style-src` deliberately keeps `'unsafe-inline'`
    and gets no nonce — CSP nonces cover `<style>` elements but never inline `style="…"` attributes,
    which React/Tailwind emit throughout, and adding a nonce there would make the browser ignore
    `'unsafe-inline'` and break the SPA's styling.

### Changed

- **Self-host DB design revised to superset-native (docs only).** `docs/SELF-HOST-DB.md` now
  specifies a **superset-native** schema *generated* from the contract + `FIELD_REGISTRY` — every
  canonical field a first-class column (tables = entities via the `entity` tag; FKs = `reference`/
  `user` fields; an `issue_links` edge table; additive migrations as the superset grows) — with the
  **OpenProject-compatible schema demoted to an export view** (OpenProject's fields are a subset of
  the superset by definition, so nothing is lost). The DB reports its real shape back through the
  broker's `describeSchema` manifest so only populated fields surface. README now points at the doc.
  **Design + README only** — the DDL generator and broker workflow remain deferred until the §7
  sign-offs; the pieces it depends on (the `entity` tag, the CI-enforced superset, `describeSchema` +
  the availability resolver) are already shipped.

- **Config-consistency cleanups (roadmap §5 smaller debt).** No behaviour change:
  - **`deploymentProfile` is now in the OpenAPI `Settings` + `SettingsUpdate` schemas** (enum
    `enterprise | business | nonprofit | self-hosted | demo`) and the regenerated client — it was a
    real persisted setting returned by `GET /settings` / accepted by the update, just absent from
    the spec.
  - **Cookie `Secure` is single-sourced** in `routes/auth.ts`: `cookieBase()` computes
    `requireTls()` fresh on every set/clear (one source of the flag) instead of a static
    module-load value plus a per-set override — so a runtime deployment-profile change applies
    consistently to session and flow cookies alike.
  - **Documented the deployment-profile precedence** (persisted wizard choice vs `DEPLOYMENT_PROFILE`
    env vs the boot security-check) in `docs/REVERSE-PROXY.md`.

- **Modularity: large components decomposed (no behaviour change).** Pure extraction, identical
  rendered output / network calls / query keys:
  - **`IssueDialog`** (708 → 436 LOC) — form state + hydrate-on-open + `buildPayload` moved into a
    `useIssueForm` hook, and the financials / effort / risk-&-quality field groups into
    `FinancialsPanel` / `EffortPanel` / `RiskQualityPanel` under `components/issue-dialog/`. The
    dialog keeps its public props and all mutation handlers.
  - **`useFormDialog`** — the hand-rolled "reset on close" pattern is now one hook, adopted by
    `NewProjectDialog`, `NewTaskDialog` and the `RaidView` add-form.
  - **`ScheduleSandbox`** — the pointer→day-shift geometry is a pure, tested `lib/drag-schedule`
    helper; the drag state and resource-contention computation moved into `useScheduleShifts` and
    `useResourceContention` hooks.

- **Stricter TypeScript: `exactOptionalPropertyTypes` on (completes the strict-TS opt-ins).**
  An optional property `x?: T` can no longer be silently assigned `undefined` — the code must
  either omit it or declare `x?: T | undefined`. The ~127 resulting sites were fixed by either a
  conditional spread (`...(v !== undefined ? { k: v } : {})`) where omission is the intent, or by
  widening the type to `?: T | undefined` where "explicitly absent" is a real state — notably the
  broker patch types (`IssueWrite`/`ProjectWrite`, where `undefined` means "no change"), OIDC
  session claims, the audit-event shape, the SCIM directory records, and autonomous-write grants.
  No runtime behaviour change; no `as`/`@ts-ignore`. With `strict`, `noUncheckedIndexedAccess`
  and this now all on, indexed access and optional-property handling are provably sound.

- **Stricter TypeScript: `noUncheckedIndexedAccess` on.** Every indexed access (`arr[i]`,
  `obj[key]`) is now typed `T | undefined`, so the compiler forces an explicit decision at each
  site. The ~35 resulting sites across the gateway, SPA, shared libs and tooling were fixed with
  real narrowing (guards, defaults, destructuring) where the undefined case is reachable, and a
  non-null assertion backed by a local invariant (just-checked `length`, regex capture after a
  successful match, loop index into the same array) elsewhere — each non-obvious one commented.
  No runtime behaviour change; no `as any` / `@ts-ignore`.

- **Broker-neutral product surface — concrete vendor purged from code, copy, routes and the API.**
  Following the broker-isolation work, the reference broker's NAME no longer leaks into the
  product. The `POST /api/setup/test-n8n` route is now `/api/setup/test-broker`; the SPA type
  `N8nTestResult`/`testN8nConnection` are `BrokerTestResult`/`testBrokerConnection`; the entire
  setup wizard, settings, report and i18n copy (4 languages) now say "broker" rather than naming a
  vendor; the deploy-template (`.env`/compose) examples and the OpenAPI descriptions are
  broker-neutral; and the contract-test script alias is `verify-broker`. The isolation guard was
  extended with a NAMING check (comments excluded) over the gateway and SPA, so the vendor token
  can only appear in the adapter folder, the seam factory that constructs it, the neutral
  broker-url resolver, and `vendors/brokers/<vendor>.json` — enforced in CI. (The generated n8n
  workflow blueprints remain n8n-by-nature, like the vendor data.) The contract-test script is
  also renamed by its function — `scripts/src/verify-n8n-bidirectional.ts` →
  `verify-broker-contract.ts` (alias `verify-broker`), and the generated workflow's normalize node
  is `BrokerActionResult`.

- **Broker-code isolation — one home per concrete broker, guard-enforced (no behaviour change).**
  All n8n adapter code now lives in a single folder, `broker/n8n/` (`index.ts` the adapter,
  `expr.ts` the expression helper that previously sat in generic `lib/`), and the deprecated
  `N8N_WEBHOOK_URL` env alias is resolved in one neutral place (`lib/broker-url`) instead of being
  read in three. A new CI guard (`guard-broker-isolation`) fails the build if any module outside
  the seam factory imports a concrete adapter — so a vendor adapter can only ever be reached
  through the generic `Broker` interface. (Vendor *naming* still present in some user-facing copy,
  route labels and deploy templates is a separate "broker-agnostic language" item.)
- **Security self-check now inspects EVERY loaded broker, not just the primary.** The plaintext-
  http broker warning previously looked at a single endpoint and missed per-kind brokers entirely.
  A new `configuredBrokerUrls` helper enumerates all loaded endpoints (`BROKER_URL`, the
  `BROKER_URLS` pool, every per-kind URL in `BROKER_ENDPOINTS`, and the legacy alias), and the
  self-check flags each remote plaintext endpoint — so a secondary broker on `http://` is caught.

- **Modularity pass — shared helpers for repeated jobs (no behaviour change).** A clean-code
  audit found a few "same job, implemented more than once" patterns; each now has a single home:
  - **`lib/sealed-file`** — the "durable state file, sealed at rest" pattern (resolve path →
    lazy read+decrypt once → seal+write back) was hand-rolled in five modules. `SealedFile` +
    `resolveConfigFile` own it now; `ai-providers`, `scim`, `audit-chain`, `security-state` and
    `config-store` delegate to it (each keeps its own parse/merge). Wire format unchanged.
  - **`lib/redis-bus`** — `notify-bus` and `broker-log-bus` duplicated the same optional-Redis
    Pub/Sub bootstrap (dynamic `ioredis` import, subscribe, mode flag, in-process fallback). A
    shared `RedisBus` base owns the bootstrap; each bus supplies only its channel, log lines,
    message handler and publish semantics.
  - **`lib/import` `commitImport()`** — the per-row write loop (ruleset-per-row → broker write
    → outcome) was extracted out of the `POST /import/commit` handler into a pure, testable
    function; the handler is now parse → commit → audit → respond.
  - **`callBrokerCapability()`** — the "501 if the broker doesn't support it / 502 on error"
    template repeated across the connection routes is now one broker helper.
  - **SPA:** `useInvalidateIssueQueries` collapses the issue-mutation invalidation list
    hand-rolled in `IssueDialog`, `NewTaskDialog` and `AgileBoard`; `parseNumberOrNull`
    (`lib/validation`) replaces `IssueDialog`'s inline coercion; and `PremiumAdmin` split into
    three self-contained panels under `components/premium/` over a shared primitives module.

### Security

- **Zero-trust boundary validation + strict TypeScript.** Untrusted request inputs are now
  PARSED against an explicit schema rather than `as`-cast into a typed shape:
  - **`lib/validate`** — a tiny, dependency-free schema validator (`v.string/number/boolean/
    enum/array/object/optional` + `parseOr400`). Each validator both narrows the type and
    enforces a rule (presence, type, length, range, pattern, allowed set), so "typed +
    validated" is one step. A schema failure returns `400 { error, issues }`.
  - Applied to the hand-rolled admin/AI endpoints that previously cast `req.body`
    unchecked — AI chat / nl-action / copilot / transcribe, the AI-provider registry +
    key + capability-mapping writes, capability containment + endpoint-probe, key/session
    revocation, and reference-ruleset apply. Free-text fields gained max-length caps (a
    cheap DoS guard on otherwise-unbounded input).
  - **`lib/env-config`** — env vars are untrusted input too: typed accessors
    (`envStr/envInt/envEnum/envUrl`, the URL one routed through the SSRF guard) plus a
    boot-time `checkRequiredEnv` that flags weak production config (short `SCIM_TOKEN`,
    `RATE_LIMIT_DISABLED` in prod). Wired into the security self-check as critical findings
    (refuses boot under `SECURITY_STRICT`).
  - **`strict: true`** (plus `strictFunctionTypes`, `noImplicitOverride`) enabled across the
    monorepo — every variable is soundly typed, with zero resulting type errors after a small
    set of `override`/cast fixes.

### Fixed

- **Frontend RBAC now matches the gateway's orthogonal model.** The SPA ranked roles
  linearly, but the gateway treats `pmo` and `admin` as independent authorities above
  manager (a pure admin does not satisfy `pmo`). `roleAtLeast` was rewritten to replicate
  `grantsSatisfy` (authority gates need the exact authority; base gates use the ladder), so
  the UI gate matches what the backend enforces.

### Changed

- **Shared primitives + catalogue-sourced backend suggestions (no behaviour change).**
  - `lib/crypto-keys` — `deriveKeyCached` (memoised sha256(secret)), `decodeKey32` (base64
    32-byte key parse) and `fingerprint` (truncated sha256 hex) replace the same boilerplate
    hand-rolled in `session-crypto`, `broker-psk`, `config-crypto`, `vault-store`, `vault` and
    `error-handler`.
  - `lib/env` — `envFlag` replaces the repeated `/^(1|true|on|yes)$/i` env parsing in `csrf`,
    `mcp`, `raw-api` and `provenance`.
  - The Settings **backend-source datalist** is now populated from the catalogue
    (`/api/setup/backends`) rather than a hardcoded vendor list — no vendor ids sit in the SPA
    ("all" remains the only built-in, non-vendor suggestion).
- **Architecture-conformance pass (audit-driven; no behaviour change).** Three sweeps
  (vendor-leak, AI-config-in-TS, single-implementation) confirmed the codebase holds its
  principles — zero vendor code above the broker seam, registries applied consistently — and
  drove four consolidations:
  - **One AES-256-GCM primitive** (`lib/crypto-aes-gcm`). The config store, session cookie,
    broker PSK hop and vault envelope each hand-rolled the identical seal/open; they now share
    it (each keeps its own prefix + key derivation). Wire format unchanged — existing sealed
    data opens as before.
  - **Copilot personas are JSON data** — authored under
    `lib/backend-catalogue/assets/personas/`, generated + drift-guarded like the methodology
    catalogue (was an embedded TS array). The gateway keeps only the selection logic; the
    content still bundles into the single-file build.
  - **Methodology reference rulesets are JSON data** — the six bundles
    (scrum/kanban/scrumban/waterfall/prince2/safe) moved to
    `lib/backend-catalogue/assets/methodology-rulesets/`, generated + drift-guarded.
  - **Health-watch KPI thresholds are tunable from the config dir**
    (`rulesets/health-thresholds.json`), with the safe defaults retained.

- **Frontend `Role` was missing the `pmo` authority.** The gateway's role ladder is
  viewer < contributor < manager < pmo < admin, but the SPA's `Role` union omitted `pmo`,
  so `roleAtLeast(pmoUser, …)` computed `NaN` and silently treated a PMO as *below* every
  gate. Added `pmo` to the union + rank.

### Changed

- **Clean-code + dedup pass after the recent high-churn work.** No behaviour change; an
  audit (three sweeps over backend, frontend and the seam) drove targeted consolidation:
  - SPA fetch/error boilerplate centralised — `safeJson` + a step-up-aware `responseError`
    in `lib/api.ts` and a `withStepUp` wrapper in `lib/step-up.ts` replace the
    copy-pasted `res.json().catch(() => ({}))` parse, the `step_up_required` throw (×6) and
    the `if (!(await stepUp())) return; try {…} catch {}` handler shape across ~10 modules.
  - The setup wizard's `GovernanceStep` now reuses the shared `useAutonomousGrants` /
    `useActionCatalogue` hooks (and their query cache) and a shared `isScoped` helper,
    dropping its duplicate inline types and a redundant fetch.
  - Gateway: a single `approvalContextFromReq()` builds the `{ surface, role, backend }`
    approval context for both enforcement points (NL→action planner + MCP executor), and the
    AI routes share `enforceOr403` / `actorFromSession` / `surfaceFromBody` helpers in place
    of four near-identical capability-gate blocks.
  - New guard test: every read-only MCP tool must be in `DEFAULT_APPROVED_ACTIONS` (and no
    write may be), so the "reads approved out of the box" contract can't silently drift.

### Security

- **Pentest-audit hardening pass.** A full security audit (auth, crypto, injection, transport,
  AI control) found the model strong; these verified gaps are now closed:
  - **Open-redirect fixed (CWE-601).** The post-auth `returnTo` (login / OIDC callback /
    step-up) is now sanitised to a same-origin path via `safeLocalPath` — absolute,
    protocol-relative (`//`, `/\`) and control-char (CR/LF) values fall back to `/`, so a
    crafted `?returnTo=https://evil` can't bounce a user off-site after sign-in.
  - **SSRF guards applied consistently.** The existing cloud-metadata/link-local egress guard
    now also covers the premium webhook URL, the capability reachability tester (request-body
    endpoint), and the OIDC issuer discovery / `token_endpoint` / `jwks_uri` fetches (which
    are IdP-controlled), blunting metadata-credential theft via a malicious config or IdP.
  - **MCP honours SCIM deprovisioning.** The MCP endpoint (mounted outside the generic auth
    middleware to allow read-only API tokens) now repeats the `isDeprovisioned` check for a
    session principal, so a deactivated user whose session hasn't expired can't act via MCP.
  - **CSRF cookie `Secure` flag** now follows `requireTls()` (TLS-aware), matching the session
    cookie, instead of `NODE_ENV` — so it can't diverge under a relaxed deployment profile.
- **Admin-gated key revocation** — a versioned key registry (session / provenance /
  broker) where each version's signing material is DERIVED from an env master
  (`HMAC(master, "name:vN")`), so an admin can **revoke + rotate** a key with no new
  secret to distribute. Revoking retires the current version and rolls forward: sessions
  signed under a revoked version are rejected at once (instant "log everyone out"
  response to a suspected compromise — including a per-user variant), and provenance
  entries under a revoked version still verify but are flagged untrusted (a leaked key
  could have forged them). Sessions carry their key version (`kver`); provenance entries
  too, so history stays verifiable across rotations. New `GET /api/security/keys`, `POST
  /api/security/keys/:name/revoke`, `POST /api/security/sessions/revoke-user` (admin,
  audited); a Settings → "Security — key revocation" admin card. RAM-only state.
- **Provable broker-call provenance (zero-at-rest) + gateway↔broker request HMAC** — a
  keyed-MAC, hash-chained record of every broker call that holds ONLY fingerprints,
  never content: the request/response bytes pass through the broker as they must, and we
  persist just `HMAC_k(content ‖ actor ‖ seq)`, chained so the whole sequence is
  tamper-evident — so zero-at-rest is fully preserved. Each call records a chained
  `invoke`/`result` fingerprint with the initiating actor and a monotonic order (no
  external clock/anchor needed — the hash links order the chain; wall-clock is an
  annotation). Admin verify endpoints prove ORDER + NON-ALTERATION (`GET /api/provenance`,
  `.../call/:id`) and prove "nothing changed" by RE-PRESENTING the content
  (`POST .../call/:id/verify`) — we never store content to reconstruct it. The same
  shared key signs outbound broker requests (`X-Omni-Sig/-Ts/-Nonce`) so a PSK-aware
  broker can refuse REPLAYED or forged traffic (`lib/broker-hmac`: timestamp window +
  single-use nonce). Honest boundary: on-device initiation/display and wall-clock are
  attestations, not proof; this targets internal consistency, not external attestation.
- **Session idle + absolute timeout** — sessions now expire after a sliding idle period
  (default 30 min) and a hard absolute lifetime (default 8 h), enforced server-side in
  the sealed cookie via `iat`/`seen` stamps: an expired session reads as "no session"
  everywhere, so every protected route rejects it (limits unattended-session /
  shoulder-surfing risk, and bounds a stolen long-lived cookie). Active sessions slide
  forward on activity (throttled re-seal); pre-upgrade cookies are stamped on first use
  rather than force-expired. Configurable via `SESSION_IDLE_MINUTES` /
  `SESSION_ABSOLUTE_HOURS` (0 disables either). The SPA gets the policy from
  `/api/auth/me` and shows a countdown warning before signing the user out and
  returning to login. (Part of a broader security pass; CSRF hardening + a gateway↔broker
  request HMAC + step-up re-auth + an injection-hardening audit are queued next.)

### Performance

- **Dev-mode performance overlay + Server-Timing** — the gateway now emits a standard
  `Server-Timing` header (`upstream` / `gateway` / `total`) alongside the existing
  `X-Omni-*` headers, so the browser's Performance API (and devtools) expose the
  gateway-vs-backend split natively. A dev-mode-only on-screen HUD surfaces the numbers
  we tune against the "2 clicks, under 1 second" adoption bar: initial load
  (TTFB → DOMContentLoaded → load), live per-API latency (count, p50/p95/max, average
  gateway vs upstream split), and route-switch responsiveness — colour-banded against
  the 1s budget. Gated exactly like the DEV MODE watermark, so it never ships to
  production.
- **HTTP compression (gzip/brotli) on the gateway** — a dependency-free middleware
  now compresses API + SPA responses (brotli preferred, gzip fallback), typically
  ~3× smaller on the JS/CSS/JSON payloads. It buffers then compresses on `end`, and
  deliberately passes through Server-Sent Events, ranged, binary and already-encoded
  responses untouched (SSE set `no-transform` + use `writeHead`, so they keep
  streaming live). A strong ETag is weakened when compressed so caches never cross the
  encodings. Traefik's edge `compress` middleware is also enabled in the standalone
  deploy (defence-in-depth; it skips already-encoded responses).
- **Immutable static-asset caching** — Vite's content-hashed assets are now served
  `Cache-Control: public, max-age=31536000, immutable` (big repeat-visit win) while
  `index.html` and the service worker stay `no-cache`, so a new deploy is picked up at
  once.
- **Lighter, faster first paint (web)** — removed the Inter webfont (4 weights
  downloaded on every load but never used; the UI is JetBrains Mono throughout) and
  moved the mono font from a render-blocking CSS `@import` to a parallel `<link>`.
  Platform re-detection on resize is coalesced to one pass per animation frame and only
  re-renders when something actually changed.

### Added

- **Per-surface / per-role / per-backend approved-actions (the full scope matrix) + a
  setup-wizard AI-governance walkthrough** — the customer-wide approved-actions allowlist
  was global (an action was approved everywhere or nowhere). An approval can now be
  **scoped** to a set of SURFACES (screen ids), a **minimum ROLE**, and/or a set of
  **BACKENDS** — any combination. An unscoped approval stays global (the default, so
  nothing regresses); a scoped one is **fail-closed** — a constrained dimension whose
  context is unknown at the call site (e.g. surface scoping evaluated on the MCP channel)
  is treated as "not allowed", so a narrowing can never leak. Enforced at both gates: the
  MCP executor checks the caller's role + active backend, and the NL→action planner checks
  the request's surface + role + backend. The admin **action catalogue** gained an inline
  scope editor (surface chips, a min-role dropdown, a backends list) and shows each
  action's scope; scopes round-trip through the sealed security-state file (back-compatible
  with older `actions`-only snapshots). A new **AI-governance step** in the setup wizard
  gives admins a guided, read-only pass over the leash during setup — enforced containment
  level, approved-action counts (how many are writes / scoped), active autonomous
  write-grants, and the break-glass kill switch — linking into Settings to tune each.
- **Portfolio copilot — methodology RAG personas, RAG/freeform toggle, published as an
  AI action** — the read-only copilot now retrieves the most relevant **methodology
  persona** for a question (Agile Delivery Lead, Programme Director, PMO Analyst, Risk &
  Assurance Manager, Stage-Gate PM) and lenses the answer through that reference guidance —
  deterministic keyword + methodology scoring, no extra egress (the same scoped, aggregated
  snapshot still reaches the model; the persona is trusted reference text, not user
  instructions). A new **answer-mode toggle** lets the user pick **RAG** (methodology lens,
  default) or **Freeform** (plain answer, no persona); the chosen persona is reported back
  and shown as "Answered as a …". The copilot is also **published as an AI action**
  (`portfolio_copilot`) — it appears in the admin action catalogue, ships **approved by
  default** (read-only), and is callable over MCP as `omniproject_portfolio_copilot`,
  inheriting the same approval allowlist, governance gate and audit as every other action.
  Kill-switch `COPILOT_PERSONAS=off` disables persona retrieval entirely.
- **Capability governance — MCP + vendor enforcement, screen-id wiring, endpoint
  checks** — enforcement now extends beyond AI: the **MCP** route refuses (JSON-RPC
  error + log) unless the MCP capability is on, and the **broker-command** edge enforces
  the active vendor's capability when it names a specific backend. The client now sends
  its current route on AI calls and the gateway **normalises it to a registry screen id**
  (`screenIdForRoute`), so per-surface overrides always match the canonical screen rather
  than a free-typed string. User-defined endpoints are **validated as http(s) URLs** on
  save, and an admin can **test reachability** from the governance card (`POST
  /api/governance/:id/test`).
- **Capability governance — brokers, no-AI-by-default, and an admin dashboard** —
  brokers (the n8n-style seam) are now governed by the same tri-state as everything
  else (self-hosted/in-cluster = `user-defined`; managed = `public`), derived from the
  broker catalogue. The default is now **NO AI and nothing brokered** — every
  capability is `off` until an admin explicitly turns it on (the active AI provider no
  longer auto-enables). Admin state changes are audited (`capability.configured`), and a
  new **Governance dashboard** (Settings, admin-only) shows what's enabled (counts per
  kind + the live list with per-screen overrides) and a **live activity trail** of
  recent uses / blocks / config changes (capability, surface, who, when) via
  `GET /api/governance/log`.
- **Capability governance — call-time enforcement + screen-registry surfaces** —
  governance is now enforced, not just configured. `enforceCapability(id, {surface,
  actor})` resolves a capability's effective state for the calling screen and **throws
  if it's off**, and `decideCapability` records every decision (allowed or denied) to
  the audit log — so there's a trail of which AI/vendor ran where and for whom. The AI
  chat route (`POST /api/ai/chat`) is the first enforced call site: the active provider
  must be permitted on the calling surface or the request is refused (403) and logged.
  Existing AI config keeps working — the active provider defaults to its natural state
  unless an admin overrides it. Per-surface overrides are now **picked from the screen
  registry** (`GET /api/governance` returns the screen list), not free-typed, so an
  override can't silently miss on a typo.
- **Capability governance — tri-state (off / user-defined / public) for every AI
  tool, the MCP, AI providers and vendors** — one admin-controlled model for where each
  capability runs: `off`, `user-defined` (the CUSTOMER controls it — truly local or
  their own remote endpoint) or `public` (third-party SaaS). Each capability advertises
  only the states it can actually run in, so the UI offers just those (a cloud-only
  provider shows only `public`; a local-only one only `user-defined`). **AI tools are
  surface-aware**: their state can be overridden per screen/context — e.g. text-to-speech
  `public` everywhere but `user-defined` or `off` on the finance screen. Everything is
  off by default, **admin-gated**, versioned (`captureVersion`) and stored in
  customer-level JSON (rides the snapshot/export). AI providers are seeded with their
  real options (Ollama → user-defined; OpenAI/Anthropic/OpenRouter → public) and vendors
  are derived from the backend catalogue. New `GET /api/governance` + `PUT
  /api/governance/:id` (admin); a Settings → "Tools, AI & vendors — data governance"
  admin card. (Supersedes the earlier egress-class + per-user-consent design and its
  "every tool must offer local" rule — governance is now wholly admin-controlled and
  per-surface.)
- **Platform & capability detection, mobile mode, PWA, native-ready seam** — the app
  now tailors itself to the device the right way: **feature-detection first**, with
  coarse OS/engine hints used only for wording and install routing (never to gate a
  capability — UA strings lie). New `lib/platform.ts` + `usePlatform()` report live
  capabilities (speech, touch, Web Share, service worker, standalone/installed, a
  reserved native-bridge flag) and form factor.
  - **Mobile mode** — a touch-optimised layout that follows the device automatically,
    with a per-user override (auto / on / off) persisted in prefs. Drives
    `data-form-factor` / `data-mobile` / `data-touch` / `data-standalone` on the root;
    touch layouts get WCAG-sized (≥44px) hit targets and installed PWAs inset fixed UI
    past device safe areas (notch / home indicator).
  - **Installable PWA** — web app manifest + maskable icons, theme-color, iOS
    `apple-mobile-web-app-*` meta and `viewport-fit=cover`. An **app-shell service
    worker** (prod only) caches ONLY hashed static assets — never `/api`, `/auth` or
    any non-GET request — so the stateless / zero-at-rest posture is fully preserved;
    navigations are network-first so a new deploy is never shadowed by a stale shell.
  - **Native-ready seam** — speech, notifications and platform sit behind interfaces,
    and `usePlatform().nativeBridge` detects an injected `window.OmniNative`, so a
    later Capacitor (or similar) shell can supply native implementations — including
    truly on-device, cross-platform dictation — reusing this exact codebase.
- **Accessibility mode: switch scanning, screen-reader narration, voice dictation** —
  three opt-in per-user accessibility features that drive the app from the user's OWN
  assistive setup (nothing bundled, nothing sent off-device, in keeping with the
  zero-at-rest ethos):
  - **Switch-access scanning** — for users who drive everything from one or two
    physical switches. *Single-switch* sweeps a highlight across the interactive
    controls on a timer (adjustable dwell, 0.5–5s) and Space/Enter selects;
    *two-switch* steps the highlight by hand on Space/→/↓ and selects on Enter. The
    current control gets a bold ring and is announced to the screen reader.
  - **Screen-reader narration** — a shared ARIA live region the app speaks through so
    dynamic changes reach NVDA/JAWS/VoiceOver; a per-user toggle gates the extra
    verbose narration so it doesn't chatter at everyone.
  - **Voice dictation** — a floating mic that dictates into the focused text field
    using the browser's native Web Speech API (on-device). Shown only when the user
    opts in AND the platform supports it, so there's never a button that can't work.
  All three persist in per-user prefs (JSON, server-side, code defaults) so they
  follow the user across sessions and devices, layered over company branding.
- **Per-user prefs persist across sessions + devices (JSON, code defaults)** — a
  person's accessibility setup (text size, background colour, high contrast, reduced
  motion) is now stored server-side as JSON keyed by their user id, so it FOLLOWS THEM
  across sessions and devices — important for users with dyslexia / visual impairment
  who shouldn't have to reconfigure each time. Standard defaults live in code
  (`DEFAULT_USER_PREFS`) and fill anything unset. localStorage stays as an instant,
  flash-free cache; the server is the source of truth once signed in (and only
  hydrates when the user actually has a saved entry, so a fresh device never clobbers
  a local setup). `GET/PUT /api/me/prefs`; rides the config snapshot/export like
  branding. Font FAMILY remains company branding; SIZE + COLOUR are per-user.
- **Connections: test-connection + broker-vault delegation** — the Connections
  screen now also lets an admin **test** a backend connection through the broker, and
  optionally **delegate a secret to the broker's own encrypted vault** instead of
  using the env template. New OPTIONAL broker contract methods `verifyConnection` and
  `storeCredential` (demo broker stubs both; a real broker maps them to its API +
  credential store). The vault relay sends the secret **once** through the gateway
  and OmniProject **stores nothing and never logs the value** — it returns only a
  non-secret reference; brokers without a vault report `501` so the operator falls
  back to the scaffolding. `POST /api/setup/connections/test` + `…/vault` (admin).
- **Connections screen — credential scaffolding, secrets never stored** — an
  admin-gated screen that works out which credentials the broker(s) need for the
  backends in use (the union of each vendor's `requiredEnv`) and generates a fill-in
  `.env` / docker-compose template (secrets rendered as Docker-secret mounts, plain
  config as env refs). It deals ONLY in credential NAMES + placeholders — OmniProject
  never receives or stores a secret value, keeping the stateless / zero-at-rest
  posture; the secret lives with the broker (its env / Docker secret / credential
  vault). Per-user-auth vendors need no stored key at all (the caller's token is
  forwarded through the seam). `GET /api/setup/connections?backends=…` (admin).
- **Drag-to-rearrange screens/reports, persisted to the customer's config** — panels
  can be dragged to reorder (and resized/hidden) on a screen, and the arrangement is
  saved as a per-screen layout override. It lives in the settings store, so it rides
  the existing snapshot / config-bundle / export machinery straight into the
  **customer's config JSON** (and the debug bundle). `applyLayout(screen, layout)` is
  a pure hide→re-span→reorder transform; `ScreenRenderer` gains `editable` +
  `onLayoutChange` (HTML5 drag, dependency-free) and a `layout` prop to render the
  saved arrangement. `GET /api/setup/screens/:id/layout` (open, the SPA needs it) +
  `PUT` (manager+, captures a config version). New panels never disappear — anything
  missing from a saved order keeps its place after the listed panels.
- **Rendering primitives — live, progressive, windowed (built on per-panel binding)**
  — instead of rendering a screen in one blocking pass, panels now compose finer
  primitives:
  - **Shared live event stream** (`lib/live-events.ts`) — ONE `EventSource` to the
    notification SSE that all subscribers share (lazy connect/disconnect), replacing
    per-component streams.
  - **Live per-panel revalidation** — a panel opting into `source.live` (optionally
    `liveOn: [kinds]`) revalidates ONLY itself when a relevant notification arrives —
    push, not polling; the refetch is conditional (304 when unchanged). A small "live"
    badge marks it.
  - **Progressive rendering** — a sourced panel shows a skeleton while it loads, so a
    screen paints panel-by-panel instead of blocking on the slowest.
  - **Windowed tables** — the table panel renders only the first `maxRows` (default
    50) with a "show all" expander, so a large dataset doesn't paint thousands of DOM
    nodes up front.
- **Per-panel data binding & independent refresh** — a screen panel can now declare
  a `source` (a read endpoint); it fetches its OWN data under its OWN query key and
  gets its OWN refresh control, so you can **refresh just one graph/table on a screen**
  without touching the rest. Built on the existing primitives: the per-panel query is
  keyed `["panel-data", url]` (refresh = refetch that one key, or
  `invalidateQueries` it), and because the read endpoints support conditional reads
  (ETag / broker `changeToken`), an unchanged refresh returns 304 and nothing
  re-renders. Panels without a `source` stay static (data inlined in `config`), so
  existing screens are unaffected. The fetched object is merged into the panel's
  `config`.
- **Opt-in server-side read cache (`READ_CACHE_TTL_MS`)** — a short-TTL in-memory
  cache of broker reads for dispersed/high-latency deployments. It is a deliberate
  performance mode that **trades the "never stale" guarantee for latency**, so it is
  **off by default**, behind an explicit flag, and **warned loudly**: a boot-time
  `logger.warn` in any environment plus a production security-self-check finding.
  Safety: **per-actor keyed** (one user's cached data is never served to another),
  **write-through** (any broker write — or a generic command/raw write via
  `invalidateReadCache()` — clears it so your change is immediately visible),
  **bounded + per-replica + RAM-only** (never disk, gone on restart). Available in
  prod and dev; unset the flag for fully live reads.
- **Conditional / delta reads — refresh only what changed, still zero-data-at-rest**
  — read endpoints now support HTTP conditional GET: an unchanged read returns
  `304 Not Modified` instead of re-sending the payload, so a client that already has
  the data keeps it. The data lives ONLY in the client cache; the gateway stores
  nothing — it just relays a version check. New OPTIONAL broker contract method
  `changeToken(ctx, resource)` supplies a cheap version (a backend ETag /
  max(updatedAt) / cursor); when the client's token matches, the gateway returns
  `304` **without performing the full backend read at all** — cutting the heavy
  cross-network round-trip that the live-read design otherwise pays on every request.
  Brokers that don't implement it degrade gracefully to a payload-hash ETag (still
  saves re-sending unchanged bytes). The backend stays the single source of truth;
  nothing is cached on the server. Wired on `/projects` and project issues; the demo
  broker implements `changeToken` (per-resource state hash). Pairs with the SPA's
  existing React Query cache (shared keys + `staleTime`) so common data is fetched
  once across pages and revalidated cheaply.
- **Dev-mode entitlement (paid-feature) toggle** — force individual premium features
  on or off to preview the licensed vs unlicensed UX without minting a real licence.
  A dev override layer that `resolveLicense` applies last, so it is **inert in
  production** (dev mode is gated off there; a CI guard asserts it), **ephemeral**
  (in-memory, gone on restart), **real-admin only**, and **audited** on every change.
  Drives the existing entitlement checks (`isEntitled`/`requireEntitlement`)
  unchanged. Endpoints `GET/POST/DELETE /api/dev-mode/entitlements` + a dev-instance
  UI panel with a per-feature toggle and a "forced" marker.
- **Ephemeral, approved, reason-logged dev impersonation** — the dev-mode auth
  bypass (act AS another user to reproduce a role-specific issue) with hard
  guardrails. Starting one needs an explicit **approval dialog with a typed reason**
  (the dialog won't submit without it); only a **real admin** may start it; it is
  **ephemeral** (30-min TTL, cleared on logout, stripped once expired) and **dev-only**
  (a stale impersonation cookie is inert in production / after leaving dev mode).
  Every start/stop is **audited with the reason**, and each impersonated request is
  tagged `impersonatedBy`/`impersonationReason` so the real actor is always
  accountable. A banner shows who/why with a one-click Stop. `GET/POST/DELETE
  /api/dev-mode/impersonate`.
- **Thin-file spoofs never appear over real data** — `demoVendorFor` enforces that a
  thin-file vendor preview applies ONLY in pure demo mode (no real backend) and never
  when a real broker is connected or the dev broker is active. So a production
  deployment with a real broker always shows the REAL vendor — only real
  vendors/brokers connected to real data appear in prod.
- **Thin-file spoof names carry a `-demo` suffix** — whenever a vendor is presented
  via a thin vendor file over sample/recorded data (demo preview or dev broker), the
  shown `kind` is e.g. `openproject-demo`, so it can never be mistaken for a live
  integration. The clean vendor id is kept separately.
- **Demo vendor preview — present the demo AS a prospect's stack** — the vendor
  capability overlay (previously dev-only) now also flavours the **demonstration**
  broker: set `backendSource` (Settings, or `BACKEND_SOURCE`) to a vendor id and the
  demo presents AS that vendor — gated to its declared capabilities from the vendor
  JSON — over sample data. So a prospect can preview how the product looks on THEIR
  setup (e.g. OpenProject, no financials/raid) with no real broker or backend
  installed. Production-safe: it only ever flavours demo data and never a real broker
  (`live` stays false; a configured n8n/dev broker is untouched). Changing
  `backendSource` rebuilds the demo live. The overlay (`applyVendorProfile`) is now
  shared by the dev broker and the demo path.
- **Dev broker — any vendor × any data source, switchable on the fly (dev-only)** —
  a developer/debug broker, distinct from the DemoBroker (which stays the
  demonstration broker for training/sales). The dev broker presents AS any **vendor**
  (e.g. `openproject`, gated to that vendor's declared capabilities from its JSON
  config) over any **data source**: `demo` (built-in sample), `bundle` (a debug
  bundle's `demo-state.json`), or `cassette` (a captured traffic tape, replayed). The
  vendor × source combination is **switchable at runtime** via `POST /api/dev-mode/broker`
  (admin, dev-only) — no restart — so you can reproduce an issue by loading its
  bundle/cassette under the right vendor profile. Seeded from `BROKER_SPOOF` /
  `DEV_BROKER_SOURCE` / `DEV_BROKER_REF`. Composes the data broker (cycle-safe Proxy);
  hard-gated to dev mode (null in production); writes are simulated.
- **Dev-mode production guard (refuse-to-boot) + transaction tagging** — the safety
  interlock for dev mode now that it grants dangerous powers. The gateway **refuses
  to boot** when dev mode is active AND the environment shows production signals
  (real OIDC/SSO, a configured licence, or a non-local `PUBLIC_URL`) — the
  combination that means "this is probably a real deployment". Fail-closed and not
  tied to `SECURITY_STRICT`; a narrow explicit `OMNI_DEV_MODE_ACK_INSECURE=1`
  downgrades the refusal to a loud warning for local testing, never silences it.
  Plus: every response on a dev instance carries an `X-OmniProject-Dev-Mode: true`
  header, and every audited transaction is tagged `meta.devMode:true`, so dev
  activity is unmistakable in the trail and filterable out of real records.
- **Dev mode: debug bundle + on-screen watermark + dev compose** — pulls the debug
  tooling into one developer-instance concept.
  - **Debug bundle (`Setup → Debug bundle`, admin)** — a single reproducible ZIP to
    replicate an issue elsewhere: `config.json` (snapshot) + `config-dir/*.json`
    (loaded JSON config) + `vendors.json` (loaded backend/broker catalogues) +
    `demo-state.json` + `capture-tape.jsonl` (the captured broker/notify/export
    traffic) + a `manifest.json`. Reload on another dev instance via Setup → Restore,
    `DEV_PERSIST_FILE`, and `pnpm broker:replay`.
  - **On-screen DEV MODE watermark** — the SPA reads the public `/api/dev-mode`
    status and shows a clear diagonal watermark + a corner badge listing the armed
    surfaces (trace/capture/persist), so a debug build can't be mistaken for prod.
  - **`docker-compose.dev.yml`** — layer over any base compose
    (`-f docker-compose.standalone.yml -f docker-compose.dev.yml`) to build a
    watermarked dev instance with trace + capture + stateful persistence armed and a
    writable `/data` volume for the tape.
  - **Hard-gated:** `isDevMode()` / the bundle / the watermark are all inert under
    `NODE_ENV=production` (CI guard tests assert it); `/api/dev-mode` reports only
    which surfaces are on — no paths or secrets.
- **Plane trace + capture/replay (dev-only debug tooling)** — a developer aid that
  makes dispatch planes observable at the *method* boundary, and lets you capture
  activity on one instance and replay it on another.
  - **Trace** — `traced(plane, obj)` wraps any dispatch object in a Proxy that logs
    every call (`→ plane.method` / `← plane.method` with timing, `✗` on failure)
    through the shared pino logger. Applied to the **broker** seam, plus the
    **notify** (routing decision) and **export** (serialisers) planes; report *data*
    already flows through the traced broker. Being a Proxy it needs no per-method
    wiring and auto-covers methods added later.
  - **Single-instruction CLI** — `pnpm broker:send <method> [jsonArg…] [--twice]`
    fires one instruction through the seam; `--twice` sends it again and diffs the
    two results to flag a non-idempotent path.
  - **Capture tape** — point `BROKER_CAPTURE` at a path and every exchange is
    appended to an ordered JSONL tape (`{seq, ts, plane, method, args, result, ms,
    ok}`), payloads full but always secret-scrubbed. The tape is portable: copy it to
    another instance.
  - **Replay** — `pnpm broker:replay <tape>` summarises it; `--serve <method>`
    returns the *recorded* response (a deterministic offline cassette — also sidesteps
    an egress block); `--redrive` re-issues the recorded instructions against the live
    broker on another instance and diffs each result against the recording to surface
    divergence. Re-drive is **read-only by default** (writes skipped unless
    `--allow-writes`; `--dry-run` lists only).
  - **Strongly gated, dev-only:** every surface is inert under `NODE_ENV=production`
    (a CI guard test asserts it); off by default; redaction-by-default with full trace
    payloads behind a second flag `BROKER_TRACE_PAYLOADS=1`; capture writes real
    activity to disk so it is a non-prod/CI artifact kept out of the production image.
    The CLIs are `scripts` entries, never HTTP routes — no new server surface.
- **Rich graph + map rendering (dependency-free SVG)** — the `graph` and `map`
  panels now render real visuals, not just the accessible summary: `graph` draws a
  node-link diagram with a circular layout; `map` plots points via an
  equirectangular projection onto an SVG world grid. Both are dependency-free (no
  D3/Leaflet) and make NO external tile calls — fitting the no-egress ethos — and
  keep an accessible (screen-reader) list alongside the visual.
- **Per-kind broker dispatch — heterogeneous brokers, actually routed** — the
  per-kind routing *decision* (`brokerForCommand`) is now a real *dispatch*. Because
  every broker platform speaks the same HTTP contract, routing a command to a kind is
  binding the one HTTP adapter to that kind's endpoint: `BROKER_ENDPOINTS` declares
  per-kind URLs (e.g. `n8n=…,node-red=…`), `endpointsForKind` resolves them, and
  `routeBrokerCall(intent, fn)` binds the call to the selected kind's endpoint for its
  scope via an `AsyncLocalStorage` override at the `webhookPool()` chokepoint — so no
  adapter method is threaded with it and concurrent requests never bleed endpoints. A
  kind with no declared endpoint falls back to `BROKER_URL` (single-broker deployments
  unchanged). This closes the gap flagged in #41/#42: n8n and Node-RED can now each be
  dispatched to their own endpoint over the uniform contract.
- **Per-user accessibility look-and-feel override** — a personal, client-side overlay
  layered over the company branding: text size (0.85–1.5×), high contrast (underlined
  links + thick focus rings), and reduced motion, in the Settings → Accessibility
  panel. It lives in `localStorage` only — nothing is sent to the server, and
  clearing it reverts to the company look — fully in keeping with the stateless,
  nothing-at-rest ethos (the company config is untouched; this is a personal layer).
  Corrupt/missing storage falls back to company defaults, never an error.
- **Graph + map visual primitives (panel kinds)** — two new `PanelKind`s registered
  in the ScreenRenderer panel registry, so they're JSON-composable like every other
  panel and capability-gated. `graph` renders a network/dependency graph from
  `config: { nodes, edges }` (edges typically from `dependsOn`/relationship fields);
  `map` renders geo-tagged entities from `config: { points }`. Both ship the
  **accessible data view** today (counts + a readable edge / location list) so they're
  usable immediately; the rich force-directed (D3) graph and tile-map (Leaflet)
  rendering slot in behind the same components + config — the noted remainder.
- **Cross-backend entity resolution (stateless)** — helpers for reconciling the SAME
  real-world entity appearing in more than one backend (a person who is a Jira
  assignee AND a Salesforce contact). `dedupeEntities(records, keyFn, mergeFn?)` MERGES
  records that share a DETERMINISTIC key (safe to auto-apply; keyless records never
  merge); `matchCandidates(records, matchers)` SURFACES likely-same records (same
  normalised email/name) as CANDIDATES for human confirmation — never auto-merged, so
  a fuzzy collision can't silently corrupt a view. Pure + stateless: no customer data
  is held; a confirmed mapping would persist as JSON in the config dir (the truth
  stays in the backends). `GET /api/setup/entity-resolution/preview` demonstrates both
  over an illustrative sample.
- **Per-kind broker command routing (decision layer)** — `brokerForCommand(intent)`
  chooses which connected broker KIND should serve a command given what it needs
  (`transport` and/or `capability`), built on the multi-broker registry. The rule:
  keep the PRIMARY (the live data/command hop) whenever it qualifies — heterogeneous
  fan-out is the exception, not the default — else the first eligible connected
  broker, else fall back to the primary. Honest scope: this is the routing DECISION;
  actual dispatch still goes through `getBroker()` (one concrete adapter + demo), so
  routing a command to a genuinely different connected platform additionally needs
  per-kind adapter instances bound to each endpoint — that's the remaining work. The
  decision is now explicit + tested, ready for those adapters.

- **Node-RED broker — with an importable flow you can truly test against** (**Stable**)
  — a seventh reference broker, added as a single JSON drop
  (`vendors/brokers/node-red.json`) — the architecture's promise in action. Node-RED
  is open-source and self-hosted, and its `HTTP In → HTTP Response` flow answers the
  read-through contract **synchronously**, so it's a genuine data hop (synchronous,
  self-hostable, inbound + outbound events; no managed per-connector auth — you wire
  credentials yourself). A free, self-hostable alternative to n8n. Ships an
  **importable flow** (`broker/templates/node-red-flow.json` + guide) that answers the
  verify handshake + capabilities out of the box — deploy it, point `BROKER_URL` at
  it, and you're exercising OmniProject against a **real external broker**, not just
  the in-memory sidecar. A test guards the flow JSON + its binding so it can't rot.
- **Methodology is a cross-plane derived grouping (presets across reports + screens)**
  (**Stable**) — reports and screens now carry a `methodologies` tag like views, so a
  methodology spans every renderable plane. `reportsForMethodology(id)` /
  `screensForMethodology(id)` are the report/screen analogues of
  `viewsForMethodology`; `allMethodologyTags()` is the cross-plane picker list (every
  defined methodology ∪ any tag any asset declares). `GET /api/setup/methodology-preset/:id`
  returns everything a methodology activates across views + reports + screens — so
  "click Kanban" surfaces the board, cumulative-flow report and all. Methodology packs
  (#36) now include the tagged reports + screens automatically. A methodology is fully
  a DERIVED grouping over tagged assets, not a standalone plane.
- **Methodology packs — a methodology is a portable bundle** (**Stable**) — now that
  every plane is JSON, a methodology is the DERIVED grouping of all assets carrying
  its tag. `methodologyPack(id)` collects a methodology's definition + its tagged
  views, notification routes and reference ruleset into one `MethodologyPack`;
  `GET /api/setup/methodology-pack/:id` (admin) downloads it as a JSON bundle an
  operator can drop into another deployment's config dir to reproduce the same look +
  rules. Neutral ("*") assets are excluded (they ship regardless). Reports + screens
  don't carry methodology tags yet (the asset-selectability work), so they're not in
  a pack today.

### Changed

- **Methodologies are JSON-defined** — the last hand-written catalogue array moves to
  JSON. Each methodology (Scrum, Kanban, Scrumban, Waterfall, PRINCE2, SAFe) is
  authored under `assets/methodologies/<id>.json` (validated against a JSON Schema,
  embedded by `gen-methodologies`, drift-guarded in CI, overlayable per deployment);
  the catalogue sources `METHODOLOGIES` from the generated array sorted by `order`.
  Every catalogue plane — backends, brokers, outputs, notifications, fields, views,
  reports, screens, methodologies — is now JSON over generic code. This is also the
  groundwork for importable methodology **packs**.
- **AI providers + column coercion are registry-driven** — two more bespoke
  `switch` statements become registries. `ai.ts` now holds an `AI_PROVIDERS` registry
  (`provider → { status, chat }`), so the AI status + chat paths route by lookup and
  adding a provider is one entry (a guard test asserts the registry covers every
  non-`none` provider). `column-mapper.ts`'s `coerceValue` switch becomes a
  `FieldType → coercer` registry. Both behaviour-identical.
- **Action dispatch is registry-driven, not switch-driven** — the two hand-written
  `switch (action)` statements become handler registries keyed by action. The
  broker-core binding switch is now `BINDING_ACTIONS` (the canonical binding-action
  registry — the single source of the action vocabulary every transport routes), and
  the MCP executor is now a handler registry tied to its declared `MCP_TOOLS`. A
  guard test asserts the MCP handlers and the declared tools match exactly (a tool
  can never ship without an executor, or vice versa). The two action sets overlap but
  neither is a subset — `list_reports`/`list_screens` are cross-plane catalogue
  actions, not backend binding calls — so they stay two registries, honestly. The
  binding behaviour is identical (conformance/blueprint/smoke suites unchanged).
- **Reports + screens are JSON-defined** — the last two renderable planes move from
  hand-written TypeScript arrays to JSON, completing what the board views started.
  Each report (`assets/reports/<id>.json`) and screen (`assets/screens/<id>.json`) is
  validated against a JSON Schema, embedded by `gen-reports` / `gen-screens` (the
  shared gen-registry engine), drift-guarded in CI and overlayable per deployment.
  The catalogues now source `REPORTS` / `SCREENS` from the generated arrays (sorted
  by an explicit `order`, so display order is preserved) and keep their types +
  capability-gating functions. All three renderable planes — views, reports, screens
  — are now JSON over generic code. No behavioural change.
- **Canonical field vocabulary is JSON, below the seam** — the ~114-field canonical
  registry was hand-written TypeScript stranded in the gateway
  (`artifacts/api-server/.../field-registry.ts`), even though the contract generator
  and the gateway both read it. The field DATA + its descriptor types now live in
  the catalogue (`field-vocabulary.ts`), authored as a single JSON array
  (`assets/fields.json`), validated element-by-element against a JSON Schema, embedded
  by `gen-fields`, and **drift-guarded in CI** — the same data-not-code pattern as
  vendors/views. Extending the vocabulary is now a JSON edit. The gateway's
  `field-registry.ts` re-exports it (so every existing import path is unchanged) and
  keeps the gateway-only reconcile/validate behaviour and the `EnumeratedField` type
  above the seam. No behavioural change — the contract is byte-identical.

### Added

- **Canonical notification-kind registry** (**Stable**) — notification kinds
  (`assignment`, `due_soon`, `blocker`, `incident`, …) were bare strings scattered
  across demo data, the routing JSON and the bell. They're now one registry
  (`notification-kinds.ts`) — each kind tagged with a severity (`info` | `warning` |
  `critical`) — the notification-plane analogue of the canonical status/priority
  vocabularies. The ingest now stamps each event with its kind's severity (so a
  channel can page on `critical`, digest on `info`); a guard test fails CI if a
  routing rule matches a kind the registry doesn't know (the kind analogue of the
  "real channel" guard); `GET /api/setup/notification-kinds` surfaces the vocabulary.

### Changed

- **Config export uses a renderer registry, not a switch** — `buildConfigExport`
  now resolves its deploy-format renderer (`env` / `compose` / `k8s`) from a
  `Record<format, renderer>` map instead of a `switch`, matching the registry idiom
  the data EXPORTERS and setup-status SECTIONS already use (adding a format is one
  entry). (The data-export `EXPORTERS` was already a registry; `xlsx` stays a
  deliberate exception — a multi-sheet workbook over all datasets.)

- **The broker plane is synchronous-only; async platforms move to outputs** —
  a platform that can't answer the binding in the SAME HTTP call isn't a broker, so
  Apache Airflow (the only `synchronous: false` entry) leaves the broker plane. The
  broker schema now enforces `synchronous: true` (a `synchronous` of `false` fails
  generation) and a guard test backs the invariant — the broker plane IS the
  synchronous data-hop plane. Airflow is re-homed in the **outputs** plane as a new
  `batch-egress` kind (`vendors/outputs/airflow.json`): a scheduled DAG that reads
  the OData/BI feeds and lands data downstream, or consumes outbound events to
  trigger batch work — the same honest limit as Zapier/IFTTT (which were already
  event-edge consumers, not brokers). The `dag-template` broker build method is
  removed. `GET /api/setup/outputs` now lists Airflow; `GET /api/setup/brokers` no
  longer does.

### Added

- **Generic notification dispatch — JSON routing above the seam** (**Stable**) —
  which event kinds go to which delivery channels is now a config decision, not
  code. Routes are authored as JSON (`assets/notification-routes/<id>.json`,
  validated + embedded by `gen-notification-routes`, drift-guarded in CI, overlayable
  per deployment) and a generic engine — `routeNotification(event, isChannelAvailable)`
  — turns an event into the de-duplicated set of **delivery intents**
  (`{route, channel, audience}`). The seam line is exact: the engine only DECIDES
  targets (dispatch); DELIVERY — posting to Slack, paging PagerDuty, sending the
  email — stays BELOW the seam (the broker workflow reads `dispatch[].channel`). On
  `POST /api/notifications/ingest` the routing decision now rides along with the
  outbound `notification` event and is returned in the response; `GET
  /api/setup/notification-routes` surfaces the rules. A guard test (the
  notification-plane analogue of the incompatibility guard) fails CI if a route names
  a channel that isn't in the catalogue, so a dangling channel can't silently never
  deliver. Each route carries a `methodologies` tag, so a methodology pack can ship
  its own routing.
- **Multi-broker router — many broker kinds connected at once** (**Stable**) — a
  registry above the seam (`broker/registry.ts`) that knows which broker KINDS are
  connected to a deployment, so the capability resolver can union what they
  collectively support. Reality of the seam: OmniProject speaks ONE HTTP contract to
  every broker platform, so "many brokers at once" isn't many gateway adapters — it's
  several platforms wired below the seam (e.g. n8n for the live data hop + Make for
  outbound events). The connected set = the active broker (PRIMARY, the live
  data/command hop) ∪ any kinds declared in **`BROKER_KINDS`** (catalogue ids;
  unknown ids dropped so a typo can't surface phantom capabilities). `resolveSupport`
  now unions broker capabilities across `connectedBrokerKinds()` instead of the
  single active kind, and `brokersSupporting(capabilityKey)` is the routing
  primitive ("which connected kind can deliver `eventsOutbound`?"). `GET
  /api/setup/brokers?connected=1` surfaces the wired set. The live data/command hop
  remains the configured synchronous broker (`getBroker()`); this widens *capability
  surfacing* across kinds, not per-kind command routing.
- **Compatibility model: one predicate, a two-plane resolver + an incompatibility
  guard** (**Stable**) — how we know which of anything to surface based on what the
  broker(s) AND backend(s) support, unified.
  - **One predicate.** Whether any surfaceable asset (report, screen, view, panel)
    appears is now a single rule, `isCapabilityMet(requirement, support)`, over a
    flat capability-key → boolean support set. `availableReports` /
    `availableScreens` call it instead of inlining the check.
  - **Two-plane key space.** The support set spans BOTH planes: the backend domains
    (`CAPABILITY_DOMAINS`) plus the broker capability keys (the new
    `BROKER_CAPABILITY_KEYS` — `synchronous`, `selfHostable`, `managedAuth`,
    `eventsInbound`, `eventsOutbound`), so an asset can require what a backend OR a
    broker supports.
  - **The resolver.** `resolveSupport(req)` folds the resolved backend domains and
    the connected broker(s)' capability keys into ONE map via `unionSupport` (OR
    across maps, taking only `true` flags). Broker support comes from the catalogue
    (`brokerSupport` / `brokerSupportUnion`, OR-unioned across connected brokers — a
    demo broker simulates the full reference broker, so it enables every broker key,
    mirroring demo's all-domains-on). The `/setup/reports`, `/setup/screens` routes
    and the MCP `list_reports` / `list_screens` tools now gate on this unified set.
  - **The guard.** A CI **incompatibility guard** (`compatibility-guard.test.ts`)
    asserts every shipped asset's declared requirement names a REAL capability — a
    dangling/typo'd requirement (which would silently hide an asset forever, or
    surface it unconditionally) fails the build — and that reports/screens always
    DECLARE their requirement (even if `null`).

  Additive; the connected-broker list is single-kind today — the multi-broker router
  (many broker kinds at once) widens it next, and `brokerSupportUnion` already ORs
  across however many it's given.
- **ScreenRenderer hosts the real methodology views as panels** (**Beta**) — a
  `view` panel kind bridges the generic renderer to the existing heavy view
  components (Kanban board, Gantt, Scrum, PRINCE2, RAID, List) via the shared
  `VIEW_COMPONENTS` registry. A screen can now embed any view as a panel (config:
  `{ view, projectId }`); the components are reused unchanged and self-fetch their
  data, so the renderer needs no data plumbing — the payoff of writing the board /
  Gantt once. Still additive (no page migrated yet).
- **Generic ScreenRenderer + panel registry** (**Beta**) — one renderer that lays a
  screen's panels onto a grid and delegates each to its panel renderer by `kind`, so
  screens, views and reports all render from JSON through ONE component (each widget
  kind written once). A screen is `{ panels[] }`; a panel is `{ kind, config }`.
  Ships the self-contained leaf kinds (metric, text, table, list); the complex kinds
  (board, chart, timeline, register) get registered as the existing components are
  wrapped as panels next. Panels are individually selectable; a `methodology` preset
  activates the panels tagged with it (per-context or throughout); capability gating
  hides a panel whose backend domain isn't fed; an unknown kind degrades to a
  placeholder. Additive — nothing migrated yet.
- **Board views are JSON-defined + methodology-tagged** (**Stable**) — the first of
  the renderable planes to move from hand-written TypeScript to JSON. Each view
  (Kanban, Scrum, Gantt, PRINCE2, RAID, List) is authored under
  `lib/backend-catalogue/assets/views/<id>.json` (validated by a JSON Schema,
  embedded by `gen-views`, drift-guarded in CI) and the SPA sources its view list
  from the catalogue (single source — no hand-kept copy). Each view carries a
  **`methodologies` tag**; a methodology is now the DERIVED set of assets sharing a
  tag (like a programme is derived from project membership), surfaced at
  `GET /api/setup/views?methodology=<tag>`. The bespoke renderers are unchanged —
  the generic `ViewBuilder` and reports/screens follow next.
- **"Lock this config" export — read ≡ dump** (**Stable**) — `GET
  /api/setup/config-bundle` (admin) downloads the current effective config as the
  EXACT folder-of-JSON the loader reads: `config.json` + the deployment's overlay
  `vendors/<plane>/*.json` + `rulesets/field-rules.json` & `rule-modes.json`, zipped.
  The customer keeps the bundle and mounts it as `OMNI_CONFIG_DIR` to persist their
  look-and-feel; the gateway stores nothing. The config-dir loader now also reads
  `rulesets/` (governance ruleset, restrict-only) and inventories `artifacts/`
  (things generated against our reference). The bundle is **config only** — never
  customer data (enforced by the config-purity guard).
- **Per-vendor vocab maps + one-click nomenclature** (**Stable**) — a backend's
  vendor JSON can declare how it names things: a **`nomenclature`** preset (canonical
  term → the vendor's word, e.g. Zendesk "Ticket", ServiceNow "Incident", Trello
  "Card") and a **`statusVocabulary`** (native status → canonical, below the seam).
  `GET /api/labels/presets` lists them; `POST /api/labels/apply-preset` adopts one in
  a click (written through the label-override allow-list) — a shortcut instead of
  re-typing each label. Shipped presets for ~10 vendors.
- **Config-purity guard** (**Stable**) — a test that fails CI if a data-bearing
  entity key (projects/issues/…) ever leaks into the config snapshot. Encodes the
  invariant: config is a folder of JSON; **true customer data is never at rest** in
  OmniProject (it's brokered live), so losing/corrupting the config JSON can't touch
  the data underneath.
- **A deployment's config is a folder of JSON, read at runtime** (**Stable**) — set
  `OMNI_CONFIG_DIR` and the gateway reads it at boot: `vendors/<plane>/*.json` to
  **add or override vendors** (schema-validated, overlaid through the catalogue
  accessors so the override flows everywhere) and `config.json` (a config snapshot)
  for **settings + label tweaks**. Every file is validated against the same schema
  the author designed against; a bad file is logged + skipped, never fatal. The
  gateway holds nothing durable — the JSON on disk is the persistence — so the code
  stays stateless and a deployment is portable as one folder. `GET
  /api/setup/config-dir` (admin) reports what loaded. The JSON-Schema validator now
  lives in the catalogue, shared by `gen-vendors` (build time) and the runtime
  loader, with the schemas embedded for portable validation.

### Changed

- **Two more dispatch points became registries** (**Stable**, internal) — continuing
  the "generic engine + registry" abstraction: the data exporters
  (`routes/export.ts`) now share one `EXPORTERS` registry (format → `{ contentType,
  render }`) with the routes derived from it, so a new single-dataset format is one
  entry (xlsx stays bespoke as a multi-sheet workbook); and `GET /api/setup/status`
  is assembled from a `STATUS_SECTIONS` registry (`lib/setup-status.ts`) so adding a
  subsystem to the diagnostics is a section, not an edit to a growing literal. Both
  behaviour-preserving. (Notification *delivery* was deliberately left below the
  broker seam — see the generic-dispatch work for the seam-correct treatment.)
- **Vendor-overlay merge is memoised + perf-guarded** (**Stable**, internal) — the
  catalogue accessors' overlay merge is now cached per plane (invalidated on
  register/clear), so a deployment overlay doesn't rebuild the merged set on every
  call; the no-overlay path stays zero-copy. A new perf guard proves the
  memoisation (reference identity) and that 100k catalogue lookups stay well under a
  second, so a future regression trips CI. (Context: the config/asset JSON is
  embedded at build time and read once at boot — never on the request path — so this
  is the one place the "everything is JSON" model could have added per-call cost,
  now closed.)
- **Two more patterns abstracted into registries** (**Stable**, internal) — applying
  the same "generic engine + registry of handlers" shape as the ScreenRenderer:
  (A) `gen-vendors` and `gen-views` now share one `gen-registry` engine (read JSON →
  validate → emit typed module), so a new asset plane is a descriptor, not a copied
  generator; (B) the config-directory loader is now a registry of per-subdir loaders
  (vendors / config.json / rulesets / artifacts), so adding `views/`/`screens/` to
  the config folder is a one-line registration. Behaviour-preserving: byte-identical
  generated output and unchanged config-load behaviour.
- **Renamed `n8n-backends.ts` → `backend-catalogue.ts`** — the file holds the
  broker-neutral backend catalogue plus the *reference* n8n binding; the old name
  wrongly implied the backends themselves were n8n-coupled. Now parallel to
  `broker-catalogue` / `notification-catalogue` / `output-catalogue`. No API change.
- **Vendor definitions are now JSON files in a directory** (**Stable**) — every
  vendor (backend, broker, notification, output) is authored as one JSON file under
  `lib/backend-catalogue/vendors/<plane>/<id>.json`, validated against a per-plane
  JSON Schema. To add a vendor you design + verify the JSON and drop it in — no
  TypeScript. A `gen-vendors` step validates every file and embeds the result into a
  portable, type-checked `vendors.generated.ts` (so the catalogue still ships no
  runtime files and works in the browser), kept honest by a CI drift guard. Pure
  form change: the 64 shipped vendors are byte-for-byte the same data. See
  [lib/backend-catalogue/vendors/README.md](lib/backend-catalogue/vendors/README.md).

### Added

- **Canonical value vocabularies below the seam** (**Stable**) — the cross-backend
  meanings the gateway reasons about (status lifecycle, priority, RAG) now live in
  one typed module (`broker/vocabulary.ts`) instead of being hard-coded as `"done"`
  / `GREEN`/`AMBER`/`RED` in neutral code. Wire fields stay open strings; a backend
  can declare a typed **`StatusVocabulary`** to map its dialect to canonical
  statuses as *data*, so a vendor's status names are abstracted below the seam
  rather than branched on in code. A new **vocabulary guard** test keeps these
  meanings in their one home, the same way the broker guard keeps vendor names below
  the seam. `programmes`, the Prometheus RAG gauge and the demo/reference brokers all
  consume the shared module (de-duplicating the RAG/`ragFor`/financial-health logic).
- **Open invitation to audit & pentest** (**Stable**) — a published vulnerability
  disclosure policy with explicit **scope, rules of engagement and safe-harbour**
  terms (test only your own instance; n8n/IdP/backends out of scope; no DoS), plus a
  machine-readable **`/.well-known/security.txt`** (RFC 9116) served by the gateway.
  See [SECURITY.md](SECURITY.md).

## [0.6.0] — 2026-06-27

A **governance, ingestion, extensibility & readability** release. No breaking API
changes (all additive); the RBAC change only tightens the top tiers. Everything
below stays **broker-agnostic, above the seam**, and every new gate is
**restrict-only** or **additive** — no security control was loosened.

### Added

- **Seven integration planes** (**Stable**) — backends, brokers, outputs,
  notifications, methodologies, reports and screens, each a registry in the shared
  `@workspace/backend-catalogue` following one principle: a neutral manifest with
  **capabilities kept separate from tools, linked**. Cross-plane links via
  `alsoProvides`; a `verify-plane` tool keeps every shipped entry honest. See
  [docs/INTEGRATION-PLANES.md](docs/INTEGRATION-PLANES.md) + the per-plane guides in
  [docs/dev/](docs/dev/).
- **Business ruleset engine** (**Stable**) — an extra, PMO-configurable governance
  layer on top of the hard rules. Built-in rules (read-only freeze, no-deletes,
  require assignee/description, schedule-sanity `due-after-start`) plus admin field
  rules ("require an estimate", "cost-centre when billable"). **Restrict-only**: it
  runs after the hard gates and can only deny/warn, never grant. See
  [docs/ops/BUSINESS-RULES.md](docs/ops/BUSINESS-RULES.md).
- **Reference rulesets per methodology** (**Stable**) — curated, named ruleset
  bundles for Scrum, Kanban, Scrumban, Waterfall, PRINCE2 and SAFe, applied by the
  PMO for compliance + completeness (`GET`/`POST /api/admin/ruleset/reference`).
- **PMO role + orthogonal authorities** (**Stable**) — a linear base ladder
  (viewer → contributor → manager) plus two **independent, joinable authorities**:
  **PMO** (business governance) and **admin** (technical config). A pure admin can't
  edit business rules and a pure PMO can't touch technical config; holding both
  grants the union. See [docs/ops/ROLES.md](docs/ops/ROLES.md).
- **Role-mapping editor** (**Stable**) — admin-only, audited `GET`/`PUT
  /api/admin/role-map` to map IdP groups to the fixed roles at runtime. By design a
  *mapping* editor, not a permission creator — it can't invent a role or grant a
  permission, so the RBAC boundary stays statically verifiable.
- **Excel/CSV import + column mapper** (**Stable**) — a pure, tested column →
  canonical-field mapper (exact / synonym / fuzzy) behind `POST /api/import/preview`
  and `/commit`; commit writes through the live backend and runs the business
  ruleset **per row** (import can't bypass governance). See
  [docs/ops/IMPORT.md](docs/ops/IMPORT.md).
- **Admin-gated raw SQL + MongoDB backends** (**Stable**) — for internally-hosted /
  legacy stores. The gateway **never ships raw SQL**: it posts a contract action +
  typed params to a sidecar that owns the parameterised queries + credentials. See
  [docs/ops/DATABASE-BACKENDS.md](docs/ops/DATABASE-BACKENDS.md).
- **Read-only MCP server** (**Stable**) — speak the Model Context Protocol over the
  broker seam; write tools are opt-in (`MCP_WRITE_ENABLED`) and contributor-gated,
  and the same neutral catalogue powers MCP, reports and screens. See
  [docs/MCP.md](docs/MCP.md).
- **More notification channels** (**Stable**) — added **MQTT** (IoT/event-bus),
  **MCP** (agent) and **Notion** alongside the existing channels, via the
  vendor-neutral notification plane. `NotificationKind` gained `iot`/`agent` and the
  delivery transports gained `mqtt`/`mcp`. See
  [docs/dev/PLANE-NOTIFICATIONS.md](docs/dev/PLANE-NOTIFICATIONS.md).
- **More backends** (**Stable / Experimental** per backend) — **Planview**
  (enterprise), **Celoxis**, **LiquidPlanner**, and **Notion** as an output target.
  All vendor specifics stay **below the seam**; the gateway only ever sees the
  neutral contract.
- **Strategic-alignment fields** (**Stable**) — a `strategy` field group (strategic
  goals, KPIs, objectives, strategic theme, value stream, contribution, expected /
  realised benefit), surfaced at **project and programme level** and capability-gated
  to the portfolio domain — so a programme can show which goals and KPIs each thing
  rolls up to.
- **Served, broker-agnostic consumer API** (**Stable**) — `GET /api/openapi.yaml`
  and `GET /api/discovery` expose the gateway's own API (the one above the seam) so
  any client can integrate without knowing the broker. The bundle is generated from
  the spec and drift-guarded in CI.
- **Raw API escape hatch** (**Experimental**) — an **admin-only**, env-gated
  (`RAW_API_ENABLED`, 503 when off), audited last-resort passthrough with a prominent
  health warning, for the rare action no typed route covers. Off by default.
- **Property-based testing in CI** (**Stable**) — a seed-deterministic,
  dependency-free property-test harness (`lib/proptest.ts`, `PROPTEST_SEED` /
  `PROPTEST_RUNS`) for structured edge-case and data-shape verification.
- **Function map** (**Stable**) — [docs/FUNCTION-MAP.md](docs/FUNCTION-MAP.md): a
  generated, one-screen-per-package index of every source file and its exported
  functions, each with the one-line comment from the code. A developer can audit how
  the codebase fits together without reading the long tech docs. Generated by
  `gen-function-map` and kept honest by a CI drift guard.

### Changed

- **Readability pass across the codebase** (**Stable**) — every source file now opens
  with a **title** saying what it does, and every exported function carries a comment
  explaining it, enforced by a new **readability guard** test (the same guard-driven
  approach as the broker/deploy/plane guards) spanning the gateway, the backend
  catalogue and the scripts package. The aim: obvious, human-readable code first,
  with the deep docs as backup.
- **Docs lead with "the broker", not n8n** — the product docs no longer imply you
  *need* n8n. OmniProject is broker-agnostic; **n8n remains the reference broker** and
  is named only where the n8n product itself is the subject (its blueprints, its setup,
  the boundary ADR).

### Architecture invariants (held + tightened)

- **Hard seam — zero exceptions.** No code above the broker seam imports a concrete
  adapter; the one remaining generic-command coupling was moved behind a `brokerCommand`
  seam helper, so the broker-guard now allows **no** adapter imports above the seam.
- **Vendors are never a plane.** A vendor/product only ever appears as a **backend,
  broker, notification or output** — never a new plane; methodologies, reports and
  screens stay vendor-neutral. Encoded as a `vendor` flag on each plane + a
  `VENDOR_PLANES` list and verified by the plane guard.
- **Don't show what no backend supports.** Reports and screens are filtered by the
  resolved (union-across-connected-backends) capability set — if nothing connected
  supports a feature, it isn't surfaced (`?available=1`).
- **Many backends ↔ many brokers, simultaneously.** Confirmed: nothing in the seam
  assumes a single backend or a single broker.

## [0.4.0] — 2026-06-25

A **modelling, history & test-maturity** release. No breaking API changes. It adds
a stateless **Exploration** workspace (snapshots → trends, a What-If sandbox, and
cross-system dependency links by hash), an opt-in **time-travel** preview, and
comprehensive **test suites with enforced CI coverage gates** where the SPA had
none — plus a 36-finding security pass. Every new surface is honestly tagged
**Stable / Beta / Experimental**, and it all stays **broker-agnostic, above the
seam**.

> **Maturity legend.** **Stable** = tested and production-intended. **Beta** =
> functional and tested but new and not yet hardened by real-world use.
> **Experimental** = complete and tested *at the seam/contract*, but the
> end-to-end path is unproven against real external systems — treat as a preview.

### Added

- **Comprehensive automated test suites + enforced coverage gates** (**Stable**).
  A new SPA test suite (Vitest + React Testing Library + jsdom, ~400 tests) where
  there was none, plus a larger gateway suite (~240 tests). CI now enforces
  coverage ratchets on both (`c8` ~84% gateway lines; Vitest v8 ~88% SPA lines).
  *Honest caveats:* SPA **function** coverage is ~64% (many inline handlers
  aren't individually invoked); several flows are render-tested, not
  interaction-tested (drag-drop optimistic moves, full pages); the axe-core a11y
  job covers the core routes only. See [docs/TESTING.md](docs/TESTING.md).
- **Exploration mode (`/explore`)** (**Beta**) — a deliberately distinct, "NOT
  LIVE DATA" surface for modelling, kept separate from the live app so a modelled
  or historical figure can't be mistaken for production. All of the following are
  **client-side and session-volatile** (the gateway stays stateless and
  zero-data-at-rest); you **download to keep** or work is discarded at session
  end. See [docs/EXPLORATION.md](docs/EXPLORATION.md):
  - **Portfolio snapshots → trends** — capture the live read-model at 1..N points,
    export/import a JSON bundle for durable multi-month trends, badged `captured`.
  - **Auto-snapshot schedule** — capture on an interval until an end date/time.
    *Limitation:* runs only while the tab is open (durable overnight cadence is
    the n8n historian's job).
  - **What-If sandbox** — a volatile fork of the portfolio with coarse
    completion/schedule/budget/blocker levers and baseline-vs-scenario deltas;
    can be based on **any captured snapshot**; "capture as snapshot" feeds trends.
    *Limitation:* portfolio-level, coarse levers — a modelling aid, not a planner.
  - **Cross-system dependency links by hash** — store **two SHA-256 fingerprints
    + minimal refs only** (never content; guarded by an anti-creep test), with
    live drift detection. *Limitation:* drift recomputes only for endpoints whose
    projects are currently loaded.
- **Time-travel** (**Experimental**) — an opt-in, gated history/replay feature.
  The contract, the admin-only + SSRF-validated + warranty-acknowledged
  **logging-sync** opt-in, the `timeTravel` capability flag, the `Broker.replay`
  method, and the gated `GET /history/replay` are complete and tested *at the
  seam*. **Unproven end-to-end:** `DemoBroker.replay` returns synthesised `sample`
  data, and the n8n historian/replay blueprint
  ([omniproject-time-travel.json](artifacts/n8n-blueprints/omniproject-time-travel.json))
  is a **template** (`active: false`) — there is no integration test against a
  live logging server yet. Forward time-travel is a `projected` model, never fact.
  Off by default. See [docs/TIME-TRAVEL.md](docs/TIME-TRAVEL.md).

### Security

- **36-finding forensic review fixed** (**Stable**) — incl. a critical
  production fail-fast on a default/empty `SESSION_SECRET`, a contributor gate on
  `POST /broker/command`, an SSRF guard on admin-set outbound URLs (incl. the
  IPv4-mapped-IPv6 metadata bypass), and no longer leaking upstream backend
  bodies in error messages. All independently re-verified.
- **`GET /settings` no longer leaks webhook signing secrets** (**Stable**) —
  the read endpoint (reachable by any authenticated session, including read-only
  API tokens) now masks webhook secrets. *Known limitation:* the endpoint still
  returns non-secret config (broker/issuer/logging-sync URLs) to any authenticated
  session; tightening that to admin-only is a follow-up.

### Changed

- **Opt-in state-history egress ("logging sync")** (**Experimental**) — off by
  default; admin-only; the destination URL is SSRF-validated; enabling **requires
  an explicit acknowledgement that egressed data leaves OmniProject's warranty**
  (the same trust class as the OData/Power-BI feeds). This is the single
  deliberate relaxation of the "nothing leaves" posture; OmniProject still stores
  nothing itself.

### Notes on architecture

- All of the above stays **broker-agnostic and above the seam**: the new
  `replay` operation is on the `Broker` interface, n8n specifics remain confined
  to `N8nBroker`, and the architecture-guard, broker-conformance and
  contract-coverage tests all pass.

## [0.3.0] — 2026-06-25

A **quality, hardening, and user-experience** release. No breaking API changes;
the focus is making OmniProject confident to run with real data, pleasant to use,
and provably backend-agnostic.

### Added
- **Comprehensive automated test suite** across five pillars — technical
  completeness, security, accessibility, UX flows, and full regression. Real
  HTTP-level security tests (401 unauthenticated, RBAC 403, read-only API tokens,
  security headers), full `Broker`-contract conformance, an OpenAPI path-coverage
  guard, an **axe-core accessibility CI job**, and a one-command
  `pnpm test:regression`. See [docs/TESTING.md](docs/TESTING.md) and
  [docs/RELEASE.md](docs/RELEASE.md).
- **Keyboard-shortcuts help** (`?`), a complete command palette (all nav targets +
  project quick-jump + shortcuts), and **breadcrumbs** on project/programme detail.
- **Undo** on board issue-move and issue-delete.
- **Deploy-artifact CI guards** so the deploy files can't silently drift again.
  A `deploy-guard` unit test fails CI if a removed env name (e.g.
  `N8N_WEBHOOK_URL`) resurfaces, if a deploy file stops wiring `BROKER_URL`, or if
  a required `${VAR:?}` in compose isn't documented in `.env.example`. A new
  `deploy-lint` CI job validates both compose files (`docker compose config`) and
  the k8s manifest (`kubeconform`). Added `.github/dependabot.yml` to keep image
  pins and CI actions fresh.

### Changed
- **User-experience overhaul (3 rounds).** Query failures now show a clear error
  with **Retry** instead of a blank "empty" screen; a **React error boundary**
  replaces white-screens; **first-run empty states** guide new users to Setup;
  **destructive actions** (promote-to-prod, rollbacks, deletes, config restore) now
  **confirm**; **inline form validation** replaces toast-only errors; the **active
  project persists** across reloads; and the app is now **responsive** (the sidebar
  collapses into a drawer on small screens). All preserving RBAC and accessibility.
- **Accessibility pass (WCAG 2.1 AA).** Skip link, per-route focus + page title,
  keyboard-operable lists/sort/menus, a focus-trapped command palette, announced
  notifications, and reduced-motion + contrast fixes — verified by the axe-core CI
  job (0 violations on the core routes).
- **Faster initial load.** Route-level code splitting + vendor chunking drop the
  initial JS from one ~977 kB bundle to a ~137 kB entry (the charting library is
  deferred to report routes), with cached cross-navigation (no refetch jank) and
  optimistic board moves.
- **More backend-agnostic.** OmniProject is designed to sit above whichever PM
  tools you run; this removes assumptions that leaked one tool's schema:
  - **Issue `status` is now an open string** in the API contract (was frozen to
    one backend's six states), so a backend with different states is no longer
    rejected on write or mis-bucketed on read. The conventional buckets remain the
    documented default; the board derives columns from the data, and unknown
    status/priority values degrade gracefully.
  - **Neutralised tool-specific copy**: the page/social meta tags no longer name
    two specific tools, and the demo dataset now spans several backends
    (Jira/OpenProject/GitHub/Azure DevOps) to show federation.
- **Hardened the deploy stack** (`docker-compose.standalone.yml`,
  `docker-compose.enterprise.yml`, `k8s-enterprise-manifest.yaml`). Pinned every
  image to a verified tag (no `:latest`); fail-fast required secrets (`${VAR:?}`,
  no more `changeme` defaults); healthchecks on every service with health-gated
  startup ordering; dropped the deprecated `N8N_BASIC_AUTH_*` (n8n uses
  owner-account setup now). The standalone stack now serves **real TLS for
  `*.local`** via mkcert + a Traefik file provider (ACME can't issue for `.local`),
  with the OIDC issuer on `https://authentik.local` resolved through Traefik
  network aliases (no host hairpin), and the Traefik dashboard moved behind
  basicauth instead of the open `:8080`. New bootstrap guide:
  [docs/DEPLOY-LOCAL.md](docs/DEPLOY-LOCAL.md).
- **Deploy hardening, round 2** (review-driven). Container hardening on the
  compose services (`no-new-privileges`, dropped capabilities + read-only rootfs
  on the stateless shell) and memory limits on the standalone stack; the
  enterprise n8n port is bound to loopback. On Kubernetes: pod/container
  `securityContext` (run-as-non-root, drop ALL caps, seccomp, read-only rootfs on
  the shell), default-deny + scoped `NetworkPolicy`s, `automountServiceAccountToken:
  false`, `startupProbe`s, and `ingressClassName` replacing the deprecated
  annotation.

### Security
- **Baseline security headers** on every response (`X-Content-Type-Options:
  nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and
  HSTS in production) — previously absent at the gateway.

### Fixed
- **Deploy files set the removed `N8N_WEBHOOK_URL`** — renamed to `BROKER_URL`
  across all three deploy artifacts. As written they silently ignored the broker
  endpoint and ran in demo mode after 0.2.0. Upgraders: rename the var in your
  deployment env/config.
- **k8s template shipped a real SSE bug** — the omni-shell Deployment defaulted to
  `replicas: 2`, but real-time notification fan-out is in-process, so a second
  replica dropped ~half of notifications. Defaulted to `replicas: 1` with a
  documented Redis-bus scale-out path.
- **k8s Secret shipped a usable `SESSION_SECRET` placeholder** — `kubectl apply`
  produced a running cluster signing sessions with a public secret. The Secret now
  ships empty (empty `SESSION_SECRET` → the gateway refuses to boot) with an
  out-of-band `kubectl create secret` recipe; the public n8n Ingress route was
  removed (n8n stays ClusterIP-only).
- **Obsolete Authentik Redis** — removed the `authentik-redis` service, volume,
  env, and health-gates from the standalone stack: Authentik dropped its Redis
  dependency in 2025.10 (moved to PostgreSQL), so the pinned `2026.5.x` never used
  it.
- **`.env` could leak into the image** — `.dockerignore` now excludes
  `.env`/`*.pem`/`*.key`/`certs` (the Dockerfile does `COPY . .`).

## [0.2.0] — 2026-06-24

**Decoupling from n8n.** Early feedback on the 0.1.0 launch kept landing on one
worry: *"isn't this just an n8n front-end — what happens to my data if n8n goes
away?"* This release answers it structurally. n8n is still the only broker that
ships, and the wire contract is byte-for-byte unchanged — but the codebase is now
*incapable of knowing the broker is n8n* above a single seam. If n8n is ever
superseded, you implement one class and nothing else moves. The public surface is
renamed to match (no more n8n in the API, env, or settings you touch).

### Removed (BREAKING)
- **The n8n-named public surface is gone — use the canonical broker names.**
  Pre-1.0 cleanup: `POST /api/n8n-proxy` → `POST /api/broker/command`;
  `Settings.n8nWebhookUrl` → `brokerUrl`; `N8N_WEBHOOK_URL` env → `BROKER_URL`;
  and `GET /api/setup/status.n8n` → `.broker` (`{ configured, urlSet }`). If you
  ran 0.1.0, update your `.env` (rename `N8N_WEBHOOK_URL` to `BROKER_URL`), any
  external API clients, and saved config snapshots accordingly.

### Changed
- **Broker boundary extraction.** The gateway now talks to a single `Broker`
  interface in its own domain vocabulary instead of calling n8n directly. n8n is
  the first/only implementation (`N8nBroker`); demo mode is a second
  (`DemoBroker`) rather than a parallel code path. All n8n specifics are confined
  to one adapter, and an architecture-guard test fails CI if any n8n-ism leaks
  above the seam — so the data path is structurally incapable of knowing the
  broker is n8n. Behaviour-preserving: same API surface, same n8n wire contract,
  same demo experience. See [docs/BROKER.md](docs/BROKER.md) and
  [ADR 0001](docs/adr/0001-broker-boundary.md).

## [0.1.0] — 2026-06-24

First public release. A stateless program-management overlay over headless PM
backends, with n8n as the exclusive data broker.

### Added

- **Overlay core** — stateless gateway (Express) + SPA (React 19), federating
  projects/issues/activity from any backend n8n can reach. Persists no project
  data; reads and writes are brokered through a single n8n webhook.
- **Programmes** — optional grouping of projects with programme-wide rollup and
  drill-down.
- **Identity & RBAC** — OIDC relying party (Auth Code + PKCE) with ID-token JWKS
  verification; viewer/contributor/manager/admin roles mapped from IdP claims;
  read-only API tokens for BI clients; demo mode when no IdP is set.
- **Enterprise backends** — declarative manifests + an n8n workflow generator
  for Jira, OpenProject, GitHub, GitLab, Azure DevOps, ServiceNow, Asana,
  Monday, Trello, Wrike, ClickUp, and the large ERPs (SAP, Primavera, Dynamics
  365, MS Project).
- **Reporting & exports** — portfolio health (RAG/variance), EVM, resource and
  progress views; CSV/XLSX/PDF/Markdown/JSON exports; OData v4 read service and a
  Prometheus `/metrics` endpoint for SAP/Power BI/Grafana.
- **Real-time** — SSE notifications with a pluggable in-process/Redis fan-out bus.
- **Internationalisation** — en/fr/de/es with multi-currency formatting.
- **Operations** — configurable action audit (off/writes/all, optional NDJSON
  sink), config snapshots, named environments with versioned rollback, and a
  stateful developer mode (non-production only) with a debug bundle.
- **Premium overlay (licensed)** — white-label branding, company-nomenclature
  label overrides, outbound webhooks, and enterprise workflow generation, gated
  by a time-limited Ed25519-signed licence key (`402` when unlicensed).
- **Monetisation** — Stripe and Gumroad webhooks that verify the purchase, mint a
  signed licence, and hand it to an n8n fulfilment workflow that emails the buyer
  their key. Importable fulfilment blueprint included.

### Security

- Trust-boundary documentation, identity-spoofing protection on the n8n proxy,
  optimistic concurrency, idempotency + loop-guard, rate limiting, and pino
  secret redaction. See [SECURITY.md](SECURITY.md).

### Licensing

- Core licensed under **Apache-2.0**; premium components under the
  **OmniProject Premium License**. Provided **as is, without warranty**. See
  [LICENSING.md](LICENSING.md).

[Unreleased]: https://github.com/walshd1/Omniproject/compare/0.6.0...HEAD
[0.6.0]: https://github.com/walshd1/Omniproject/compare/0.4.0...0.6.0
[0.4.0]: https://github.com/walshd1/Omniproject/compare/0.3.0...0.4.0
[0.3.0]: https://github.com/walshd1/Omniproject/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/walshd1/Omniproject/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/walshd1/Omniproject/releases/tag/0.1.0
