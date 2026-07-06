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

- **[gap] Multi-tenancy.** Designed end-to-end in `docs/MULTI-TENANCY-DESIGN.md` (tenant context
  via AsyncLocalStorage, per-tenant config/vault/keys, fail-closed broker scoping, isolation test
  matrix) but **not implemented**. Single-tenant today. Needs the 5 open decisions in that doc
  answered before Phase 1 (tenant-context plumbing).
- **[idea] MD RAG persona files.** Experienced PM/PgM methodological personas as retrieval files
  for the copilot — recommended, not built (awaiting go-ahead). *(Partially shipped: the copilot
  now lenses answers through methodology personas authored as catalogue JSON; standalone
  retrieval `.md` files are the remaining idea.)*

---

## 5. Smaller debt / cleanups

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
- **[bug] `StatusBreakdownWidget` groups by a field `Project` doesn't have.** It reads
  `(p as { status?: string }).status ?? "unknown"`, but the canonical `Project` type
  (`lib/api-client-react/src/generated/api.schemas.ts`) has no `status` field — every real
  project falls into the "unknown" bucket, making the widget's per-status grouping and
  most-common-first sort dead in production even though `widgets.test.tsx` exercises the
  grouping logic correctly (via a cast to a shape real data can never have). Needs either adding
  a `status` field to the canonical `Project` contract (and wiring brokers to populate it), or
  pointing the widget at a field that actually exists.
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
- **[correctness debt] Exploration's global `dirty` flag is a single unscoped boolean, so one
  source's "downloaded" action can wrongly clear another source's undownloaded work.**
  `lib/exploration.ts` exposes one module-level `dirty` shared by every writer/reader across the
  exploration surface — nothing scopes it per data source. Confirmed by tracing the actual code
  paths: `ReplicaWorkbench.tsx`'s effect (keyed on `[replica, qc]`) calls `markExplorationDirty()`
  whenever replica mode is entered, independent of any staged snapshot/edge. Its own "Export"
  button calls `exportReplica()` (`lib/explore-replica.ts`), which only triggers the file download
  and never calls `markExplorationClean()` — so exporting the replica does not, and nothing else
  does either. Meanwhile `Explore.tsx`'s `downloadExploration()` calls `markExplorationClean()`
  *unconditionally* after only conditionally exporting snapshots/edges. Net effect: entering
  replica mode with zero staged snapshots/edges, then clicking the page's "Download exploration"
  button, exports nothing (both are empty) but still clears `dirty` — so the "Unsaved exploration"
  banner disappears and the `beforeunload` warning is torn down, even though the replica overlay's
  edits were never downloaded and are still headed for loss on tab close. Found via a security
  review of `Explore.test.tsx`'s new coverage of the download/pop-out/exit flows; not fixed here —
  the real fix is a design decision (e.g. scope `dirty` per source, or have `exportReplica` mark
  its own source clean and have the page only clear sources it actually exported), not a one-line
  patch.
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

1. **Verification sweep (§1)** — smoke-test the cloud adapters, OTLP, and the Authentik
   blueprint against real services; pin versions + capture required IAM/policies. *Highest ROI;
   de-risks everything already shipped.*
2. **Shared-state seam (§2)** — Redis-backed option for the RAM-only registries, so the hardening
   behaves correctly behind multiple replicas.
3. **Multi-tenancy Phase 1 (§4)** — only if the GTM needs pooled tenancy; start with
   tenant-context plumbing behind a `currentTenant()` shim (no behaviour change).
4. **Governance UX + personas (§4)** — wizard governance walkthrough + the MD RAG personas.

---

*Keep this current: when you ship something here, delete the line; when you find new debt, add
one. A short, true list beats a long, aspirational one.*
