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

### Security findings — offensive red-team review, 2026-07-21 (fix before the next release)

A six-surface pass (authn/session/sign-off, RBAC/delegation, SSRF/egress, injection/deserialization,
client-side, crypto/sealed-store) found the crypto, egress, and client-side layers **strong**, with
one confirmed CRITICAL and a corroborating cluster — most sharing one root cause: the env-only
"is this production?" detector is blind to the product's own flagship *real-local-accounts, no-SSO* profile.

- **[security — CRITICAL, FIXED 2026-07-21] The boot-time secret guard was blind to runtime local users, so a
  SUPPORTED deployment booted on the PUBLIC default `SESSION_SECRET` → forgeable admin cookies.**
  `productionSignals()` (`lib/dev-mode-guard.ts:36-55`) is env-pure and decides "real auth" via the env-only
  `isDemoAuthFrom` (`lib/auth-config.ts:78-92`), which counts only SSO / `MAGIC_LINK_ENABLED` /
  `LOCAL_USERS_ENABLED`. But native local accounts work whenever `OMNI_CONFIG_DIR` is set
  (`userDirectoryEnabled = artifactStoreEnabled`, `lib/user-directory.ts:56-58`) — `LOCAL_USERS_ENABLED` is
  only an OPTIONAL declare-intent flag. So a deployment that sets `OMNI_CONFIG_DIR`, bootstraps an admin at
  runtime, and leaves SSO + `SESSION_SECRET` + `NODE_ENV` unset (the documented self-hosted / charity /
  homelab profile) has `productionSignals()` empty, and `evaluateSessionSecret`
  (`lib/session-secret-guard.ts:35-41`) accepts the public `DEV_SESSION_SECRET`. An attacker who read this
  Apache-2.0 source HKDF-derives the seal + cookie-signing keys and forges a signed+sealed admin cookie
  (`amr:["hwk"]`, fresh step-up) — full admin, defeating `LOCAL_ADMIN_REQUIRE_PASSKEY` and every
  `requireStepUp` route, zero interaction. **Same root cause, corroborated:** the sealed config store /
  vault / key-registry fall back to PUBLIC source-embedded dev masters on those same deployments
  (`lib/config-crypto.ts:35`, `lib/vault-store.ts:69`, `lib/key-registry.ts:50` — "zero-at-rest" becomes
  theatre; the vault holds AI keys); `OMNI_APPROVALS_AUTO_APPLY` is NOT inert there
  (`lib/settings-guard.ts:19-21`), so a posture-reducing `brokerUrl`/webhook change skips the passkey
  sign-off; and session/CSRF cookies ship without `Secure` (`auth.ts:101-108`). **Fixed:** a post-config-load
  re-check — `assertSessionSecretForLocalPrincipals(localUsersActive())`, called from `index.ts` after
  `loadConfigDir()` (`session-secret-guard.ts`) — refuses to serve on a missing/default `SESSION_SECRET` once a
  real *active* local account exists. Because the at-rest master-key ladder (`crypto-keys.masterSecret`)
  resolves to `SESSION_SECRET` before its dev fallback, forcing a real secret ALSO closes the public
  dev-master-key exposure; and `approvalsAutoApply()` now additionally gates on `!localUsersActive()`, so the
  sign-off can't be silently skipped either. `localUsersActive()` is the precise signal — it stays false for
  the zero-account CI/throwaway-store shape, so nothing legitimate is forced. Regression:
  `lib/session-secret-local-users.test.ts` drives the real directory signal end-to-end. **Residual (LOW,
  unfixed):** the `Secure` cookie flag on `lan-ok` profiles is a deliberate LAN-without-TLS posture, left as-is.
- **[security — HIGH, confirmed] The generic def importer (`POST /api/defs`, kind `config`) bypasses the
  governance guards on the SAME config store.** Security-classified configs (`history-retention`,
  `logging-sync`, `error-telemetry` — `lib/security-config.ts`) must, on a relaxing change, be held for a
  passkey sign-off; their dedicated writers route through `applyConfigCollectionGuarded`
  (`lib/settings-collection-router.ts:86`, `lib/config-guard.ts:63`). `/api/defs` writes the identical store
  with none of it — `routes/defs.ts:144-181` blocks only vendor-controlled kinds, `runDefWriteHook` guards
  only `kind==="form"` (`lib/def-write-hooks.ts:20`), then `putDef`s directly. Because `resolveHistoryRetention`
  reads via LOGICAL-ID fold (`readConfigCollection`→`configDefLayers`→`scopeLayers`, `lib/scoped-config.ts:54-71`),
  a smuggled org `config` def with `payload.id:"history-retention"` is folded into the resolved value — so a
  `pmo` (org def gate = pmoOrAdmin) shrinks the audit-retention window (or repoints `logging-sync`) with NO
  proposal and NO passkey: an admin-classified relaxation performed by the wrong authority. **Same root cause
  (MEDIUM):** the admin-only `def-scope-policy` (who may author defs where) is folded from an org config def
  (`lib/def-policy.ts:70`) a `pmo` can write via `/api/defs`, lowering the authoring gate itself. **Caveat:**
  in DEMO mode pmo/admin orthogonality collapses (all authorities granted, `lib/rbac.ts:268`), so this only
  bites a REAL IdP deployment with `defImporter` enabled. **Fix:** run security-classified logical ids through
  `applyConfigCollectionGuarded` inside the importer choke point (or reject reserved logical ids at
  `runDefWriteHook`). NB — the ruleset/settings scope-overrides are NOT affected: they read by exact singleton
  id (`readScopedConfigValue`), which a random-UUID importer id cannot forge.
- **[security — HIGH, needs a regression test] Custom-roles reimport skips the sanitizer → base-role
  privilege escalation.** `applyDefStoreExport` (`lib/def-store-export.ts:175-185`) writes `custom-roles` /
  `def-policy` / `def-binding` / `user-prefs` on only an `{id}`-shape check (no per-kind validator), and
  `getCustomRolesConfig` (`lib/custom-roles.ts:125-130`) trusts the stored row at read time — so a crafted
  plaintext `defs-import` bundle (admin + step-up gated, `routes/setup/config-io.ts:220`) carrying
  `{baseRole:"admin", groups:[<attacker IdP group>]}` confers write-capable grants without ever passing
  `sanitizeCustomRolesConfig`. **Fix:** route every config blob through its real sanitizer on import (add
  `custom-roles → sanitizeCustomRolesConfig` to `CONFIG_VALIDATORS`) or re-sanitize in the getters.
- **[security — LOW/MED, FIXED 2026-07-21] Sealed secret-store files written world-readable (no `0600`).**
  `lib/sealed-file.ts`, `lib/user-credentials.ts`, `lib/instance-key.ts` now pass `0o600` to `openSync` (the
  temp file's mode survives the atomic rename); a `sealed-file` test asserts the resulting mode is `0600`.
- **[security — LOW/MED, hardening] Internal-network SSRF reachable by an admin in the default config.**
  The RFC1918/loopback egress block (`lib/egress.ts:117`) is opt-in (`EGRESS_BLOCK_PRIVATE`, off by default
  so `http://n8n:5678` works); cloud-metadata stays blocked always and the broker seam pins IPs + refuses
  redirects (verified solid — no metadata-SSRF). Recommend documenting `EGRESS_BLOCK_PRIVATE=true` +
  `EGRESS_ALLOWLIST` as the hardened default. Lesser hardening notes: `Login.tsx` post-auth redirect leans
  on the server's `safeLocalPath` with no client-side guard (add `isSafeRedirect` for symmetry with
  step-up); the CSP is strong but env-overridable (`CONTENT_SECURITY_POLICY`/`CSP_SCRIPT_SRC` are
  security-sensitive config).

- **[gap] The entire n8n contract has never executed inside real n8n.** CI's "n8n contract
  verification (bidirectional)" step (`.github/workflows/ci.yml`) and `verify-broker-contract.ts`
  both run the gateway against a hand-rolled Node HTTP server standing in for "whatever the broker
  webhook returns" — n8n itself (its Webhook trigger, IF/Switch semantics, Code-node execution,
  `responseNode` wiring, the exact node `typeVersion`s the generator emits) has never imported or
  run a single workflow `generateWorkflow()` produces. The CI step's own name overclaims what it
  checks. This is the single highest-value missing test in the repo, because it's the one thing
  every deployment depends on and nothing catches a generator regression (bad Switch rule, wrong
  `outputKey`, a Code-node template-string bug, a node `typeVersion` the pinned n8n release
  doesn't support) before a real operator's import does.
  **Scope (not yet started):**
  1. **Spike first, unscoped work after:** prove n8n can be driven headlessly in CI at all —
     creating an owner account + API key (or working via the internal `/rest/` session API) without
     the setup wizard, importing a workflow, activating it, and hitting its real (not `-test`)
     webhook — against the pinned `n8nio/n8n:1.123.61` image, in a throwaway script before any CI
     wiring. This is the one unknown that could reshape the whole approach.
  2. **No live vendor account needed for phase 1.** Generate the workflow for
     `REFERENCE_BACKEND` (`artifacts/api-server/src/broker/reference-backend-blueprint.ts`) — it's
     plain HTTP, forwards the caller's bearer token via an expression (no n8n-managed credential to
     provision), and its one env var (`YOUR_API_BASE`) can point at a second mock HTTP server also
     started in CI. That server plays "the vendor API," not n8n — so real n8n only proves out ITS
     OWN execution of the generated JSON, which is exactly the gap. Round-trip: gateway/CI
     generates the workflow → import into n8n → activate → POST a synthetic `BrokerRequest` at the
     real webhook → assert the `BrokerActionResult` shape n8n returns.
  3. **Native-node transport (Asana-shaped: `kind: "n8nNode"`) is a separate, smaller check.**
     Executing it against a live vendor hits the same "can't hold real credentials in CI" wall as
     the verification-freeze backends below — descope to import + activate only (proves the
     generator's native-node output is structurally valid n8n JSON), not a live call.
  4. New CI job/step, `services:`-style n8n container (no existing precedent in this workflow to
     copy) + the mock backend; budget ~30–90s added wall time; main flakiness risks are container
     boot ordering and webhook-activation timing, both bounded with the same
     poll-until-healthy pattern the gateway step already uses.
  **Action:** do the spike (item 1) as its own throwaway/scratch exercise first; only write it up
  as a committed task once headless n8n automation is proven to work against the pinned version.
- **[caveat] External secret/KMS adapters are mock-verified only.** The native AWS Secrets
  Manager (SigV4), Azure Key Vault (AAD), HashiCorp/HCP, and the KMS/BYOK unwrap paths
  (`lib/vault-aws`, `lib/vault-azure`, `lib/vault-store`, `lib/kms`, `lib/aws-sigv4`) are
  exercised against a stubbed `fetch`. The wire shapes and signing construction are tested, but
  not a single call has hit a live cloud endpoint.
  **Action:** a one-time smoke test per backend against a real account; capture the exact IAM
  policy / Key Vault access policy / Vault policy needed, and add to the deploy docs.
- **[caveat] OTLP export is mock-verified and smoke-tested against a local listener, not a real
  collector.** `lib/tracing.test.ts` and `lib/otlp-metrics.test.ts` now mock `fetch` for
  `exportSpan()`/`exportMetricsOnce()` (parity with the vault/KMS adapters above), and both have
  been run against a real local HTTP listener standing in for an OTLP collector — confirmed a real
  trace span and a real periodic metrics push land correctly-shaped. What's still open: neither has
  been validated against an actual Datadog/Jaeger/Tempo/Grafana-Agent collector.
  **Action:** smoke test against one real OTLP collector; confirm trace/span IDs render and the
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
Single-instance deployments are fine; behind N replicas these don't share state.

The **`SHARED_STATE` seam** now exists (`lib/shared-state`): an opt-in async KV that's in-process
by default and Redis-backed fleet-wide when `REDIS_URL` is set — mirroring the rate-limit /
broker-log pattern (optional `ioredis`, lean by default). `sharedStateMode()` reports the active
mode. Registries adopt it incrementally:

- **[done] Maker-checker proposal queue** (`lib/dual-control`) now uses the seam — a proposal
  raised on one replica is approvable on another when Redis is configured.
- **[caveat] Concurrent-session cap** (`lib/session-registry`) is still per-replica RAM — its
  accessor is on the synchronous per-request session-read hot path, so it needs an async refactor
  before it can adopt the (async) seam. A user could still hold up to `cap × replicas` sessions.
- **[caveat] Audit-chain head** (`lib/audit-chain`) is in-memory unless `AUDIT_CHAIN_FILE` is
  set; across replicas each has its own chain (the SIEM copy is still self-verifying per event).
  Adoptable via the seam (its writes can be async) as a follow-up.
- **[debt] The settings store** (`lib/settings`) is in-memory, seeded from env/config-dir.
  Runtime changes (incl. the deployment profile) are per-replica until a config-dir reload.
  **Action:** broadcast a change over the existing bus (reload), or back it with the seam, so a
  rolling restart isn't needed for fleet consistency.

---

## 3. Security model — deliberate boundaries

These are documented in `docs/AI-SECURITY.md §6`; restated here so they're not "discovered".

- **[caveat] Shared-secret MACs by default.** Provenance + the audit chain authenticate to a
  holder of the master (tamper-**evident**). Non-repudiation against the gateway is now available
  as an opt-in: set `SIGNING_PRIVATE_KEY` to Ed25519-sign the chain anchors (`lib/signing.ts`),
  verifiable with the published public key (`GET /api/security/signing`).
- **[caveat] Internal-consistency provenance.** Order + non-alteration are verified internally
  (monotonic counter + hash links) with no external time anchor; a holder of *both* the
  provenance and broker keys could forge a self-consistent history.
- **[caveat] Encryption protects data at rest**, not against someone holding the master/process.
- **[caveat] Prompt injection is mitigated, not eliminated** (closed vocab, schema-bound args,
  default-deny writes, human confirm); containment ensures the worst case is a refused/clarifying
  response, not a silent action.

---

## 4. Not built yet (designed or deferred)

- **[gap] Multi-tenancy.** Designed end-to-end in `docs/archive/design/MULTI-TENANCY-DESIGN.md` (tenant context
  via AsyncLocalStorage, per-tenant config/vault/keys, fail-closed broker scoping, isolation test
  matrix) but **not implemented**. Single-tenant today. Needs the 5 open decisions in that doc
  answered before Phase 1 (tenant-context plumbing).
- **[idea] MD RAG persona files.** Experienced PM/PgM methodological personas as retrieval files
  for the copilot — recommended, not built (awaiting go-ahead). *(Partially shipped: the copilot
  now lenses answers through methodology personas authored as catalogue JSON; standalone
  retrieval `.md` files are the remaining idea.)*

---

## 5. Smaller debt / cleanups

- **[debt — HIGH PRIORITY, do ASAP] The SPA (`artifacts/omniproject`) is a single ~440-source-file
  package and it no longer scales.** One workspace package holds the entire front end — every
  feature domain (wiki, whiteboard, proofs, reports, scheduling, registry, portal, view-engine,
  screen/def engine, …) lives in one `src/` tree tested by one Vitest project. This has become
  untenable at the CI seam: producing a single coverage report over all ~440 files in one process
  needs >12 GB and OOMs regardless of coverage provider (this is the root cause behind the
  `unit-spa` OOM saga — see the sharding note in `.github/workflows/ci.yml`; CI now runs the SPA suite
  SHARDED WITHOUT suite-wide coverage — the coverage GATE is SUSPENDED (the istanbul provider + thresholds
  remain in `vitest.config.ts` only for a narrower local `test:coverage`), a workaround, not a
  fix). The same monolith slows typecheck, build, and IDE responsiveness, and makes ownership
  boundaries mushy. **Fix:** split the SPA into workspace packages by feature domain, each with its
  own tests + coverage gate + build, composed at the app shell. Each package's coverage then runs
  independently and small, the CI sharding/merge dance disappears, and builds/typecheck parallelise.
  This is a sizeable refactor (module boundaries, shared UI/util extraction, routing seams) but the
  monolith is now actively holding back CI — prioritise it. *Owner-flagged untenable; do soon.*
  **Approach (owner-directed):** land the current work to `main` first so `main` is a clean snapshot
  of the last monolithic version, then modularise on a fresh branch. **Mirror each module with its
  JSON** — co-locate a feature's code and its shipped JSON assets (screen/report/form defs, mappings,
  seeds) under the same package (e.g. `packages/wiki/{src,assets}`, `packages/whiteboard/{src,assets}`)
  so it is obvious at a glance what data belongs to what module. Today the code lives in
  `artifacts/omniproject/src/**` while its JSON is scattered across `lib/backend-catalogue/src/screens/*.json`,
  `assets/mappings`, settings presets, etc.; the split should pair them. Keep a thin shared core
  (view-engine, def-compose, primitives, UI kit) that feature packages depend on.
- **[debt] Large branch / changelog churn.** The last integration was 85 commits; keep future
  work in smaller, single-concern PRs to ease review and reduce changelog conflicts.
- **[a11y bug] Toast actions are unreachable while a modal dialog stays open.** Radix's Dialog
  focus scope marks sibling portals `aria-hidden="true"` while the dialog is open. The app's
  toast viewport is one such sibling, so when a mutation inside an open dialog (e.g. deleting an
  issue from the edit dialog) triggers a toast with an action button (e.g. "Undo"), a screen
  reader user cannot reach that button until the dialog closes — even though it's visible on
  screen. Found via IssueDialog.test.tsx's delete/undo test, which has to pass `{ hidden: true }`
  to `getByRole` to reach the button at all (a working-around-the-symptom test flag, not a real
  fix). Needs either rendering the toast viewport inside the dialog's own portal/focus scope, or
  moving destructive-action toasts to fire only after the triggering dialog closes.
- **[debt] `isBypassed` is hand-duplicated between `lib/pwa.ts` and `public/sw.js`.** Both encode
  the "never cache /api, /auth, /oauth, or non-GET" policy independently, so a fix to one (see the
  case-sensitivity/exact-path bug just fixed in `lib/pwa.ts`) doesn't propagate to the other unless
  someone remembers to hand-port it. `public/sw.js` also has zero test coverage of its own — it's
  a raw service-worker script (uses `self`/`caches`), not something Vitest can import directly.
  Needs either building `sw.js` so it can import the shared `isBypassed` from `lib/pwa.ts`, or a
  dedicated test harness (e.g. a minimal service-worker-global shim) that exercises `sw.js` as its
  own module.
- **[security debt] `EnvironmentsStep`'s promote/rollback/known-good actions skip step-up re-auth
  that comparably consequential admin actions elsewhere require.** `promoteEnvironment`,
  `rollback`, and `markKnownGood` (`lib/setup.ts`) all take immediate, live effect ("Live traffic
  will use the restored settings immediately" / "immediately use the promoted settings" — the
  component's own confirm-dialog copy) and are gated only by a `ConfirmButton` click, never by
  `lib/step-up.ts`'s `withStepUp`. Every other comparably sensitive admin mutation in the codebase
  (`SecurityKeys.tsx`, `ActionCatalogue.tsx`, `AiProvidersAdmin.tsx`, `GovernanceDashboard.tsx`,
  `ConfigDirPanel.tsx`, and `setup.ts`'s own `refreshConfigDir`, which has an explicit "Call behind
  `withStepUp`" comment) wraps its mutation in `withStepUp` first. Found via a security review of
  `EnvironmentsStep.test.tsx`'s new coverage of the promote/rollback/known-good flows. Not fixed
  here — wrapping these calls also requires reworking `envAction`/`doRollback`'s own try/catch
  toasts, since `withStepUp` swallows the wrapped function's thrown error (`catch { return null;
  }`) rather than propagating it, so this needs a considered pass, not a one-line change. Needs
  wrapping `promoteEnvironment`/`rollback`/`markKnownGood` in `withStepUp` and surfacing failure
  via `withStepUp`'s `null` return instead of a caught exception.
  **Same gap found in `BrandingAdmin.tsx`'s `reset()`**: it DELETEs the branding config and
  reloads the page immediately after only an `AlertDialog` confirm, never `withStepUp`, same
  category as above. Found via a security review of `BrandingAdmin.test.tsx`'s new coverage of the
  reset flow; not fixed here for the same reason (needs the same `withStepUp`-swallows-errors
  rework, done once for all affected components rather than piecemeal).
- **[security debt] `FeatureModulesAdmin`'s `toggle()` has no draft/dirty gate — every click is an
  immediate, unreviewed `PATCH /api/settings`.** `toggle()` recomputes the full disabled-feature-id
  set from render-time props and calls `setDisabled.mutate(...)` synchronously on click, with no
  optimistic-concurrency control (no ETag/If-Match) against a concurrent admin's own change. This is
  the same fundamental class of gap as `RateCardAdmin`'s `useDraftAdmin` (a stale read between the
  page loading and the write landing), but worse: `useDraftAdmin`'s panels narrow that window to
  "load → click Save", whereas here there is no Save step at all, so the vulnerable window is the
  entire time the tab is open. Found via a security review of `FeatureModulesAdmin.test.tsx`'s new
  coverage of the toggle flow. Not fixed here — it needs the same explicit dirty/Save-gate (and
  ideally a shared optimistic-concurrency primitive) that would also benefit `RateCardAdmin`, so
  it's best done once across both rather than piecemeal per component.
- **[RESOLVED] Exploration's global `dirty` flag data-loss bug — fixed (proof sweep, §6).**
  `lib/exploration.ts` now tracks the dirty state **per source** (`snapshots` / `edges` / `replica`
  / `shifts`): `markExplorationDirty(source)` / `markExplorationClean(source)`, and the aggregate
  `isExplorationDirty()` stays true while ANY source is unsaved. Each "download = save" path clears
  only what it exported — `exportSnapshots`→`snapshots`, `exportEdges`→`edges`, `exportReplica`→
  `replica`; `Explore.tsx`'s `downloadExploration()` no longer clears unconditionally (it relies on
  the per-source exporters, so a snapshot download can't tear down the replica overlay's warning).
  No-arg `markExplorationClean()` still clears everything for an explicit discard/reset. Two
  regression tests pin the exact loss scenario (`exploration.test.ts` + `Explore.test.tsx`). *(The
  original suggested fix — scope per source + have each exporter clear its own source — was applied
  in full.)*
- **[altitude] The backend-catalogue growth freeze (`scripts/src/lib/backend-freeze.ts`) is a
  bespoke one-off in `gen-vendors.ts` rather than living in `plane-verifier.ts`'s existing `CHECKS`
  registry.** `plane-verifier.ts` already holds per-plane business-rule invariants (e.g. the
  backends plane's `kind === "import"` exemption), but its `CHECKS` entries are per-entry
  (`(e, errors) => void`), while the freeze is an aggregate, whole-list check — it doesn't fit that
  signature as-is, which is why it was wired directly into the generator instead. Found via a
  clean-code review of the `verification` field PR. Not restructured here — the fix is a small
  parallel `PLANE_INVARIANTS` registry (`Partial<Record<PlaneId, (rows) => string[]>>`) next to
  `CHECKS`, with `gen-vendors.ts` calling one generic `runPlaneInvariants(group.label, rows)` for
  every plane instead of special-casing "backends" by name — worth doing once a second aggregate
  invariant (for this or another plane) actually needs the same seam, not preemptively for one.

---

## 6. Suggested sequencing

1. **Split the SPA into workspace packages (§5, owner-flagged ASAP)** — the ~440-file front-end
   monolith is now actively holding back CI (coverage OOM, worked around with istanbul + sharding),
   builds, and typecheck. Break it up by feature domain so each package tests/builds independently.
2. **Verification sweep (§1)** — smoke-test the cloud adapters, OTLP, and the Authentik
   blueprint against real services; pin versions + capture required IAM/policies. *Highest ROI;
   de-risks everything already shipped.*
3. **Shared-state seam (§2)** — Redis-backed option for the RAM-only registries, so the hardening
   behaves correctly behind multiple replicas.
4. **Multi-tenancy Phase 1 (§4)** — only if the GTM needs pooled tenancy; start with
   tenant-context plumbing behind a `currentTenant()` shim (no behaviour change).
5. **Governance UX + personas (§4)** — wizard governance walkthrough + the MD RAG personas.

---

*Keep this current: when you ship something here, delete the line; when you find new debt, add
one. A short, true list beats a long, aspirational one.*
