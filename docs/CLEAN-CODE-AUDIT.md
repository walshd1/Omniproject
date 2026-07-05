# OmniProject Clean-Code Audit

_Whole-codebase clean-code review — stateless PM/PgM overlay_
_Date: 2026-07-01 · Files reviewed: 519 across 9 source groups · Findings: 67_

> **This is a point-in-time snapshot, not a current file count.** The codebase
> has grown substantially since 2026-07-01 (well past 519 files) — treat the
> per-finding file:line citations below as historical record (each was true when
> found and fixed), not the "67 findings, zero defects" line as a live coverage
> claim. Re-run the review if you need current numbers.

---

## 1. Executive Summary

**Overall health verdict: GOOD (B+).** OmniProject is a well-factored codebase. The audit surfaced **zero correctness/security defects** and no high-severity issues — every finding is a *cleanliness* concern (duplication, minor inconsistency, small inefficiency, or dead code). The dominant signal is **copy-paste duplication of small, load-bearing helpers** that the codebase has *already* centralized elsewhere but that individual sites bypass. This is the healthiest possible failure mode: the right abstractions exist (`SealedFile`, `safeJson`/`responseError`, `RAG_TEXT`, `lib/load-core.ts`, `crypto-keys.ts`), they are simply under-adopted.

The two systemic risks worth prioritizing:

1. **Drift in security-sensitive primitives.** Constant-time string comparison is hand-rolled in ~5 lib files (`api-token.ts:21`, `csrf.ts:66`, `broker-hmac.ts:74`, `scim.ts:49`, `provenance.ts:151`), and sealed-file encryption I/O is re-implemented in `vault-store.ts` and `rate-card-store.ts`. Divergence here is a latent correctness/security hazard, not just noise.

2. **Inconsistent error handling on SPA mutation clients.** Some mutation clients (`security.ts` `revokeKey`/`revokeUserSessions`, `tools.ts` `saveCapability`/`testCapabilityEndpoint`) skip the `res.ok` check that every sibling uses, so **failures resolve silently as success** — the closest thing in this audit to a real bug.

Breakdown by severity: **0 high · 15 medium · 52 low.** By category: reuse/duplication dominates (~30 findings), followed by simplify (~18), consistency (~13), plus a handful of efficiency, dead-code, and naming items.

---

## 2. Coverage (files reviewed per group)

| Group | Scope | Notable findings |
|---|---|---|
| `api-routes` | API server Express routes | 8 |
| `api-broker` | Broker decorator stack | 7 |
| `api-lib-a` | API lib (a–h) | 6 |
| `api-lib-m` | API lib (m–v) | 7 |
| `spa-pages` | SPA page components | 9 |
| `spa-components` | SPA shared components | 7 |
| `spa-lib` | SPA lib/client modules | 10 |
| `catalogue` | `lib/backend-catalogue` | 3 |
| `scripts` | Build/gen/load scripts | 10 |
| **Total** | **519 files** | **67** |

---

## 3. Findings by Theme

### Theme A — Security-sensitive primitives re-implemented (highest concern)

- **Constant-time equality hand-rolled 5×** — `lib/api-token.ts:21` (`timingSafeEqual`), `csrf.ts:66` (`safeEqual`), `broker-hmac.ts:74`, `scim.ts:49`, `provenance.ts:151` (`safeEq`). _Fix:_ add `constantTimeEqual(a, b)` to `crypto-keys.ts` (the designated "small shared crypto primitives" home) and route all five through it. Five copies of a security comparison is exactly the drift risk `crypto-keys`/`crypto-aes-gcm` were created to remove.
- **Sealed-file I/O re-implemented, bypassing `SealedFile`** — `lib/vault-store.ts:76` and `lib/rate-card-store.ts:52` hand-roll `resolveConfigFile` + `readMaybeSealed` + `sealConfig`+write, duplicating what `sealed-file.ts` centralizes for its other adopters (ai-providers/scim/audit-chain/security-state/config-store). _Fix:_ back both stores with a `SealedFile(...)` so encryption + fallback error handling can't drift.
- **Vault adapter RMW duplicated 4×** — `lib/vault-aws.ts:51` and the azure/hashicorp/http stores each re-implement the identical `put`/`del` read-modify-write closure over a `ref→value` map. _Fix:_ `mapBackedStore(id, read, write)` helper in `vault-store.ts`.

### Theme B — Inconsistent mutation error handling (silent-failure risk)

- **`revokeKey` / `revokeUserSessions` never check `res.ok`** — `lib/security.ts:29`. Every other mutation in the file (`exportConfigBundle`, `setMaintenance`) and siblings (`containment.ts`, `ai-providers.ts`) throw `responseError` on failure. A failed revoke resolves as success. _Fix:_ add `if (!res.ok) throw responseError(res, await safeJson(res))`.
- **`saveCapability` / `testCapabilityEndpoint` never check `res.ok`** — `lib/tools.ts:114` / `:103`. Diverges from every other admin mutation client (`actions.ts`, `containment.ts`, `feature.ts`). _Fix:_ same guard.

### Theme C — The "one canonical helper" that callers bypass

The codebase repeatedly documents a single home for an idiom, then re-inlines it elsewhere.

- **`safeJson`/`responseError` bypassed ~8×** — `lib/api.ts:27` is documented as "the one place the `res.json().catch(() => ({}))` idiom lives", yet `ai.ts:31`, `stt.ts:48`, `nl-action.ts:34`, `setup.ts:143/171/197`, `auth.ts:110`, `step-up.ts:18` re-inline body-parse + `.error` extraction.
- **`downloadJson` blob-download bypassed 3×** — `lib/custom-report-file.ts:66` is "the one place the download idiom lives"; re-implemented in `setup.ts:30`, `snapshot.ts:46`, `dashboard-file.ts:45`. Additionally, the anchor-download in `components/setup/shared.tsx:9` is byte-identical to `ExportMenu.tsx:12`.
- **`num` finite-coercion copy-pasted 5×** — `capex.ts:53`, `benefits.ts:61`, `income.ts:39`, `financial-summary.ts:26`, `capacity-actuals.ts:61`. _Fix:_ one `num()` in a finance util.
- **`mulberry32` PRNG duplicated** — `lib/messy-data.ts:32` redefines the PRNG already exported by `proptest.ts`.

### Theme D — Duplicated RAG / financial-display UI primitives (SPA)

- **`RAG_DOT` / `RAG_TEXT` re-declared inline** — `pages/Programmes.tsx:15`, `pages/ProgrammeDetail.tsx:25`, `components/ProgrammeFinancialsCard.tsx:7` (as `HEALTH`), `ProjectFinancialsStrip.tsx:6`, `reports/FinancialEvmChart.tsx:8` — all duplicate the exported constants in `lib/methodology.ts`. _Fix:_ import them; `Prince2View` already does.
- **Display-currency block copy-pasted 3×** — `ProjectFinancialsStrip.tsx:30`, `ProgrammeFinancialsCard.tsx:32`, `FinancialEvmChart.tsx:39`. _Fix:_ `useDisplayCurrency(nativeCurrency)` hook in `lib/currency.ts`.
- **Local `Stat` card redefined 4×** — `FinancialEvmChart.tsx:26`, `ProgrammeFinancialsCard.tsx:9`, `ProjectFinancialsStrip.tsx:8`, `views/ScrumView.tsx:10` — while `reports/StatCard.tsx` already provides a shared one.
- **Utilisation-band `barColor` duplicated** — `reports/CapacityRollup.tsx:15` vs `reports/ResourceHeatmap.tsx:7`.
- **Completion-% formula duplicated** — `pages/Projects.tsx:28` vs `ProgrammeDetail.tsx:38`.
- **Dev-mode fetch inlined instead of `getJson`** — `DevModeWatermark.tsx:24`, `DevPerfOverlay.tsx:27`.
- **`rows={x as unknown as ...}` double-cast at 7 `DataProvenance` call sites** — `pages/Home.tsx:53` et al. _Fix:_ widen the `rows` prop once.

### Theme E — Route-handler boilerplate & shared derivations (API)

- **External base-URL derivation re-implemented 5×** — `auth.ts:67`, `odata.ts`, `api-spec.ts`, `setup.ts`, `integrations.ts`, with subtly different `PUBLIC_URL` handling. _Fix:_ `lib/request-origin.ts externalBaseUrl(req)`.
- **`allIssues(req)` defined byte-identically** in `export.ts:32` and `odata.ts`. _Fix:_ move to `lib/data.ts`.
- **Settings-key CRUD pairs near-identical 4×** — `views.ts:13`, `dashboards.ts`, `custom-reports.ts`, `report-overrides.ts`. _Fix:_ `settingsCrudRouter({ key, field, writeRole?, label })` factory (~120 lines → one helper).
- **`getSession(req)` called twice per audit-actor line** — `rate-card.ts:46`, `ruleset.ts:35`, `role-map.ts`, `snapshots.ts`. _Fix:_ `actorForAudit(req)` calling `getSession` once (as `ai-providers.ts`/`security.ts` already do).
- **`projectId` safeParse+400 duplicated ~8× in one file** — `projects.ts:100`. _Fix:_ `router.param('projectId', …)` or `parseProjectId(req,res)`.

### Theme F — Broker decorator-stack duplication

- **Read-method cache key duplicated** — `single-flight.ts:47` vs `cache.ts:93`. Must agree for coalescing+caching to key consistently. _Fix:_ shared `readKey(method, args)`.
- **Read-intercepting Proxy get-trap copy-pasted 3×** — `single-flight.ts:44`, `cache.ts:79`, `messy-broker.ts:44`. _Fix:_ `readInterceptingProxy(base, onRead)`.
- **Neutral-selector guard (`'all'`/`'none'`) duplicated** — `vendor-profile.ts:29` vs `demo.ts:349`.
- **Decorator stack ordering lives only in prose** — `index.ts:171` hand-chains six order-dependent wrappers. _Fix (low):_ express as ordered `{ when, wrap }` list reduced over the base broker.
- **`identity.ts:8` doc over-promises** — claims every row is source-stamped, but `stampSource` only covers `listProjects`/`listIssues`. _Fix:_ stamp uniformly at the seam or soften the comment.

### Theme G — Script harness duplication

- **Demo-login cookie flow duplicated 4×** — `e2e-smoke.ts:28`, `stress-test.ts:29`, `load-harness.ts:40`, `verify-broker-contract.ts:147`. _Fix:_ shared login/`authedHeaders()` helper.
- **ANSI color helpers re-declared ~6×** — `e2e-smoke.ts:15`, stress-test, load-harness, verify-broker-contract, integration-openproject, wizard. _Fix:_ `scripts/src/lib/ansi.ts`.
- **Recursive `.ts` file walkers 3×** — `guard-broker-isolation.ts:53`, `guard-interactive.ts:27`, `gen-function-map.ts:76`. _Fix:_ `listSourceFiles(dir, opts)`.
- **`stress-test.ts:35` re-implements load-core primitives** — `pct`, worker-pool, error accounting all exist as tested `percentile`/`runPool`/`Recorder`/`summarise`/`verdict` in `lib/load-core.ts`. _Fix:_ rebuild on load-core (~40 lines removed).
- **8 single-group generators are line-for-line copy-paste** — `gen-views.ts:23` + gen-widgets/reports/screens/methodologies/methodology-rulesets/personas/notification-routes. _Fix:_ `emitSingleGroupRegistry(root, opts)` helper.
- **4 near-identical `http.request` wrappers** — `verify-broker-contract.ts:176` (`post/patch/get/method`). _Fix:_ one `request(verb,url,body?,headers?)`.

### Theme H — Consistency: config/threshold/role divergences

- **`evaluateHealth` defaults to `DEFAULT_THRESHOLDS` while `runHealthWatch` uses `getHealthThresholds()`** — `health-watch.ts:77`. A direct `evaluateHealth()` call silently ignores operator-tuned thresholds. _Fix:_ default to `getHealthThresholds()`.
- **`config-snapshot.ts:44` re-lists snapshot keys by hand** despite `SNAPSHOT_KEYS` — the two lists can silently drift. _Fix:_ iterate `SNAPSHOT_KEYS`.
- **`plane-verifier.ts:80` accepts a `"pmo"` role** no other module recognizes (`screen-catalogue.ts:16`, `notification-routing.ts:23` omit it). _Fix:_ derive from a shared role constant or drop `"pmo"`.
- **`availability.ts:79` hardcodes `from:"issue"`** while `availabilityFromManifest` carries the real `from` — capabilities fallback mislabels all edge origins.
- **Dev-mode read/write gate split** — `dev-mode.ts:227` GET is `requireDevMode` only while sibling POST/DELETE add `isRealAdmin`. Also `dev-mode.ts:159` inlines the real-admin check one way while `isRealAdmin(req)` exists.

### Theme I — Dead code & minor efficiency

- **Dead code:** `broker/n8n/index.ts:466` `N8nBroker.command()` unused (all callers go through `commandWithSource`); `session-registry.ts:45` unreachable empty-map branch.
- **Redundant env re-parse:** `cache.ts:48` `readCacheStats()` parses `READ_CACHE_TTL_MS` 3×; `gen-vendors.ts:34` reads each plane schema from disk twice; `gen-registry.ts:48` redundant final `.sort` on already-sorted rows.
- **O(n²) in cycle recovery:** `schedule-scenario.ts:161` `order.includes(id)` in a loop — use a `Set`.

### Theme J — Naming / duplicated-logic housekeeping

- **`SnapshotBundle` name collision** — `snapshot.ts:23` (signed `{manifest,data}`) vs `snapshots.ts:46` (trend `{schema,exportedAt,snapshots[]}`). _Fix:_ rename to `SignedSnapshotBundle` / `PortfolioSnapshotBundle`.
- **`BROKER_INBOUND_RESPONSE` bakes vendor name** — `verify-broker-contract.ts:46` hard-codes `source:"plane"`, violating the broker-neutral posture. _Fix:_ neutral `"sample"`/`"demo"`.
- **Duplicated group-by/topo logic:** `firedRuleIds` (`cost-rules.ts:51` vs `governance-rules.ts:52`); `groupByOrdered` (`entity-resolution.ts:79`); Kahn topo-sort (`critical-path.ts:77` vs `schedule-scenario.ts`); programme-group sentinel `"__standalone__"` (4× in `portfolio-finance.ts:84` et al.); `speechSupported` (`platform.ts:86` vs `speech.ts`).
- **Derivable-state / import-ordering nits:** `methodology-rulesets.ts:60` `methodology` == `id`; `branding.ts:82` / `effectiveBranding` hand-lists 8 fields; `Home.tsx:4` / `ProjectDetail.tsx:14` consts split the import block; `Home.tsx:53` guard written twice; `messy-data.ts:62` `GREMLIN_IDS` temporal coupling; `oidc.ts:288` JWT-payload decode duplicated.

---

## 4. Top 20 Fixes (highest ROI first)

| # | Fix | Files (anchor) | Sev | Why (ROI) |
|---|---|---|---|---|
| 1 | Add `res.ok`/`responseError` guard to revoke mutations | `lib/security.ts:29` | med | Silent-failure bug: failed revoke looks like success |
| 2 | Add `res.ok`/`responseError` guard to capability mutations | `lib/tools.ts:114`,`:103` | med | Same silent-failure class |
| 3 | Shared `constantTimeEqual` in `crypto-keys.ts` | `api-token.ts:21` (+4) | med | Security primitive, 5 copies drift |
| 4 | Route vault store through `SealedFile` | `vault-store.ts:76` | med | Encryption I/O can't drift |
| 5 | Route rate-card store through `SealedFile` | `rate-card-store.ts:52` | med | Same, encryption correctness |
| 6 | Adopt `safeJson`/`responseError` at ~8 sites | `lib/api.ts:27` (+8) | med | Consolidates advertised helper |
| 7 | `settingsCrudRouter` factory | `views.ts:13` (+3) | med | ~120 lines → one tested helper |
| 8 | `externalBaseUrl(req)` shared helper | `auth.ts:67` (+4) | med | Proxy/base-URL behaviour defined once |
| 9 | Default `evaluateHealth` to `getHealthThresholds()` | `health-watch.ts:77` | med | Entry points disagree on defaults |
| 10 | Build snapshot from `SNAPSHOT_KEYS` | `config-snapshot.ts:44` | med | Hand-list drifts when key added |
| 11 | Import `RAG_DOT`/`RAG_TEXT` from `methodology.ts` | `Programmes.tsx:15` (+4) | med | 5 UI copies of colour map |
| 12 | `useDisplayCurrency` hook | `ProjectFinancialsStrip.tsx:30` (+2) | med | Currency block copy-pasted 3× |
| 13 | Canonical blob-download helper | `custom-report-file.ts:66` (+4) | med | Download idiom re-inlined 4× |
| 14 | Shared `num()` finite-coercion | `capex.ts:53` (+4) | med | 5 finance copies |
| 15 | Rebuild `stress-test` on `load-core` | `stress-test.ts:35` | med | ~40 lines, one measurement path |
| 16 | `emitSingleGroupRegistry` helper | `gen-views.ts:23` (+7) | med | 8 copy-paste generators |
| 17 | One `request(verb,...)` in contract verifier | `verify-broker-contract.ts:176` | med | ~90 lines → one impl |
| 18 | Reconcile `"pmo"` role with type unions | `plane-verifier.ts:80` | med | Verifier vs type contract disagree |
| 19 | Shared `actorForAudit(req)` (getSession once) | `rate-card.ts:46` (+3) | low | Efficiency + de-dup, 4 sites |
| 20 | Remove dead `N8nBroker.command()` | `broker/n8n/index.ts:466` | med | Dead code, verified no callers |

---

## 5. Systemic Patterns to Adopt

1. **"One canonical helper" must be enforced, not documented.** Several modules advertise themselves as the single home for an idiom (`safeJson`, `downloadJson`, `SealedFile`, `crypto-keys`), yet callers re-inline. Add lint rules (e.g. `no-restricted-syntax` banning `res.json().catch`) or a small guard script so bypass is caught in CI rather than review.

2. **Every mutation client throws on `!res.ok`.** Make this the invariant for all SPA lib mutation functions; the two exceptions found (`security.ts`, `tools.ts`) are the only real risk in the audit.

3. **Route/broker cross-cutting behaviour belongs in shared middleware.** Base-URL derivation, `projectId` validation, audit-actor resolution, and settings CRUD are all request-shaped concerns better expressed as `router.param`/factory/helper than re-typed per handler.

4. **Derive lists from a single constant.** `SNAPSHOT_KEYS`, the role union, `DEFAULT_BRANDING` keys, `GREMLIN_IDS` — wherever a second hand-maintained list mirrors a constant, iterate the constant so adding an entry flows through automatically.

5. **Share tested primitives across scripts.** `lib/load-core.ts` and a new `scripts/src/lib` (ansi, login, file-walk) should back every harness, so measurement, auth, and traversal have one implementation.

6. **Keep the broker vendor-neutral in tests too.** The `"plane"`-in-fixtures leak (`verify-broker-contract.ts:46`) shows the neutrality guard covers `src/` but not script mocks; extend the guard's scope.

**Verdict recap:** no bugs, strong existing abstractions, mostly under-adoption. Landing the Top 20 removes ~500 lines of duplication and closes two silent-failure gaps and the security-primitive drift risk.
