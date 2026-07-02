# OmniProject — Speed / Responsiveness / Design-Patterns Review

_Staff-engineering synthesis · scale target 60 programmes / 200 projects · 60 findings · 155 files across 7 groups_

## 1. Executive summary & verdict

**Verdict: SHIP-BLOCKING PATTERNS, NOT SHIP-BLOCKING BUGS.** Nothing here is a correctness defect that fails at small scale — the app works today. But the codebase has a **consistent set of ~10 recurring anti-patterns that each turn an O(1) operation into O(portfolio)**, and they compound at the stated scale (200 projects). The through-line: the product is a _stateless overlay_, so almost every screen and feed re-derives portfolio-wide state on demand, and the current code re-derives it **more times than necessary** — per render, per keystroke, per pointer frame, per request, and per broker read.

Three failure modes dominate and are worth fixing before the 60/200 target is real traffic:

1. **Portfolio fan-out with no concurrency bound** — `Promise.all` / `useQueries` over every project (200-way thundering herds) in at least 8 places (exports, OData feeds, My Work, Global Search, replica capture, prefetch, resource roster). This saturates the browser's 6-connection limit and trips backend (Jira/OpenProject) 429s.
2. **Pure static derivations rebuilt on every call** — the backend catalogue, feature-governance catalogue, broker capability tables, and env/config parsing are all invariant over static imports yet get rebuilt per request / per lookup. This is avoidable allocation + GC pressure on the hottest paths (auth, routing, feature gating, every broker read).
3. **React derivations that never hit their memo** — `useQueries` returns a fresh array reference every render, so every `useMemo` keyed on it re-runs a full 200-project aggregation on unrelated re-renders (i18n change, sibling widget settling, every keystroke). This is the single most common user-perceptible jank source.

The good news: **most fixes are small and local** (memoize at module scope, thread one derived value, swap `.find` for a `Map`, add `combine` to `useQueries`, bound a fan-out). Effort is low relative to impact. Recommend a focused hardening pass on the Top 15 below before scale testing.

## 2. Coverage per group

| Group | Files' area | Findings | Highest severity | Dominant theme |
|---|---|---|---|---|
| **api-routes** (`artifacts/api-server/src/routes`) | export, odata, projects, rate-card, index | 8 | medium | Unbounded portfolio fan-out; redundant full-portfolio fetches |
| **api-broker** (`artifacts/api-server/src/broker`) | single-flight, registry, router, cache, provenance, n8n | 7 | high | Per-access proxy allocation; O(n²) routing; re-parsed env |
| **api-lib** (`artifacts/api-server/src/lib`) | feature-modules, capabilities, read-cache, column-mapper, rbac, ip-allow, rate-card-store | 7 | high | Static catalogue rebuilt per request; per-request env re-parse; unbounded cache |
| **spa-pages** (`artifacts/omniproject/src/pages`) | MyWork, Settings, Reports, Programmes, ProjectDetail | 10 | high | Query storms on mount; busted memos; stringly-typed enums |
| **spa-components** (`artifacts/omniproject/src/components`) | reports, board, views, search, dashboard | 11 | high | Per-frame re-filter on drag; busted memos; N+1 search fan-out |
| **spa-lib** (`artifacts/omniproject/src/lib`) | explore-replica, monte-carlo, prefetch, critical-path, i18n, global-search, forecast-curve, schedule-scenario, resource-load | 10 | high | Serial round-trips; O(n²)/spread hot loops; unmemoized provider values |
| **catalogue** (`lib/backend-catalogue/src`) | component/vendor/screen/backend/broker/report/view/methodology catalogues, entity-resolution | 7 | high | Linear `.find` where a Map belongs; catalogue rebuilt per lookup |

Coverage is even and the same patterns appear on **both sides of the seam** (server broker layer and SPA), which is itself the signal: these are architectural habits, not isolated mistakes.

## 3. Findings by theme

### Theme A — Unbounded portfolio fan-out (query waterfalls / thundering herds)
_The single biggest scale risk. One user action or one feed poll spawns ~200 concurrent backend reads._

| File:line | What happens | Fix |
|---|---|---|
| `artifacts/omniproject/src/pages/MyWork.tsx:35` | `useQueries` fires one `/issues` fetch per project, 200-way, on tab open | Add a server-side "issues assigned to me" read, or bound the `useQueries` fan-out into a pool; saturates the browser 6-conn limit today |
| `artifacts/omniproject/src/components/search/GlobalSearch.tsx:51` | Opening Cmd+K fans out one full `/issues` fetch per project to substring-match titles client-side | Server-side search endpoint (or per-project title index); bounds payload to matches |
| `artifacts/omniproject/src/lib/explore-replica.ts:185` | `captureReplica` does 200×7 = 1,400 fully-serialized round-trips (~3 min wall-clock @120ms) | `Promise.all` the 7 sub-resources per project; bounded pool (6–8) on the outer loop → seconds. Keep per-call `safe()` |
| `artifacts/omniproject/src/lib/prefetch.ts:90` | `runPredictive` schedules 200 distinct speculative broker GETs synchronously on render | Cap in-flight prefetches (4–6) and/or slice to first N visible rows — the module's own doc-comment warns against this |
| `artifacts/api-server/src/routes/export.ts:32` | `allIssues()` fans out `getIssues` over every project, unbounded | Bound to ~8–12 (chunk or `p-limit`); 200 concurrent per export trips 429s / exhausts sockets |
| `artifacts/api-server/src/routes/odata.ts:62` | Same unbounded fan-out, but on **every** Power BI / SAP feed poll | Extract one shared bounded `allIssues` helper, reuse in export.ts + odata.ts (kills duplication too) |
| `artifacts/api-server/src/routes/projects.ts:195` | `GET /resources` fans out `projectMembers` over all 200 projects unbounded | Bound the roster fan-out; also lacks the `analyticsLimiter` this class of endpoint uses elsewhere |
| `artifacts/api-server/src/broker/n8n/index.ts:482` | `verify()` fires every probe at one broker simultaneously | Bound to ~4–6 — a diagnostic path shouldn't itself become the herd single-flight exists to prevent |

### Theme B — Static/pure derivations rebuilt on every call (memoize at module scope)
_Everything below is invariant over static imports or static env, yet recomputed per request / per lookup._

| File:line | What happens | Fix |
|---|---|---|
| `artifacts/api-server/src/lib/feature-modules.ts:248` | `requireFeature`/`isFeatureEnabled` rebuilds the **entire** governance catalogue (FEATURE_MODULES + all REPORTS + all METHODOLOGIES), allocates ~10 Sets, then `.find`s one id — per gated request | Memoize `governanceCatalogue()`/`governanceGates()` at module scope (pure over static imports); keep `scopeOverrides()` per-call; pre-filter to the requested id before resolving |
| `lib/backend-catalogue/src/component-library.ts:90` | `componentLibrary()` re-derives the whole report+widget library on every call; `getComponent`/`componentsFor` rebuild it from scratch each time | Build `LIBRARY` once at module load; back `getComponent` with `Map<id, LibraryComponent>` → O(1) instead of O(components)/lookup |
| `artifacts/api-server/src/broker/registry.ts:127` | `brokerForCommand` calls loop-invariant `brokersSupporting()` per candidate, each re-running `connectedBrokers()` + re-parsing `BROKER_KINDS` → O(n²) on the write path | Hoist to a `Set` before the filter; memoize `connectedBrokers()` for the call |
| `artifacts/api-server/src/broker/router.ts:20` | `endpointsForKind` re-parses `BROKER_ENDPOINTS` env string on every routed call | Memoize parsed `Map<kind,string[]>` keyed on the raw env value (preserves hot-reload, caches the common case) |
| `artifacts/api-server/src/lib/rbac.ts:148` | Every auth check re-parses env role comma-lists ~5×; `requireRole` computes grants twice on the 403 path | Memoize parsed env sets (invalidate on `setRoleMap`/`resetRoleMap`); iterate claims against the set |
| `artifacts/api-server/src/lib/ip-allow.ts:103` | `ipAllowGuard` parses `IP_ALLOWLIST` twice/request and re-parses each CIDR to bigint per request | Parse once into `{version, base, mask}[]`; match against pre-parsed entries |
| `lib/backend-catalogue/src/backend-catalogue.ts:146` | `brokersForTransport` re-scans all brokers per backend though only two transport values exist | Precompute both transports once, index by transport |
| `lib/backend-catalogue/src/methodology-pack.ts:45` | `methodologyPack(id)` re-filters VIEWS/REPORTS/SCREENS/ROUTES on every call | Precompute a `Map<methodologyId, {views,reports,screens,routes}>` once |
| `lib/backend-catalogue/src/vendor-schema.ts:25` | `validate()` compiles a fresh `RegExp` per string value → recompiles same pattern per array element | Cache compiled pattern in `WeakMap<JsonSchema, RegExp>` |

### Theme C — React derivations that never hit their memo (`useQueries` fresh-array trap)
_The dominant user-perceptible jank source. `useQueries` returns a new array reference every render, so any `useMemo`/derivation keyed on it re-runs a full 200-project aggregation on **every** render — including unrelated ones._

| File:line | What recomputes needlessly | Fix (same for all) |
|---|---|---|
| `artifacts/omniproject/src/components/reports/use-portfolio-items.ts:30` | `projects` per-project mapping + all downstream derivations, every render | Use `useQueries` `combine` (memoized on underlying results) to produce derived data, or key memo on a stable data signal |
| `artifacts/omniproject/src/pages/MyWork.tsx:46` | `mine`/`grouped` re-flatten+refilter 200 projects on every keystroke/tab switch/live event | `combine` option |
| `artifacts/omniproject/src/components/search/GlobalSearch.tsx:59` | `issues` re-materializes cross-project array on every keystroke before search even runs | `combine` option |
| _recurs identically in:_ `ExecBoardPack.tsx:78` (`consolidateFinancials`), `CapacityRollup.tsx:55` (`rollupByProgramme`), `PortfolioRoadmap.tsx:75` (`buildRoadmap`), `widgets.tsx:109` (`CapacityActualsWidget`) | Each runs an O(200) aggregation on unrelated state changes | Same `combine` fix — **treat as one systemic pattern** |

### Theme D — Per-frame recompute on drag / pointer events (responsiveness)
_These fire many times per second during a gesture; each does an O(all-items) pass or a full state-driven re-render._

| File:line | What happens | Fix |
|---|---|---|
| `artifacts/omniproject/src/components/board/AgileBoard.tsx:173` | Columns grouped via `issues.filter(...)` inside `columns.map`, re-run for every column on **every `onDragOver`** (many/sec) | One memoized `Map<status, Issue[]>` grouping pass; `React.memo` `IssueCard`; lift `dragOverStatus` |
| `artifacts/omniproject/src/components/board/GanttChart.tsx:181` | `onPointerMove` → `setDrag` re-renders entire `lanes.map` (all rows recompute offset/width) per frame | Drive dragged bar via CSS var/transform ref during gesture, commit on pointer-up; or memoize rows |
| `artifacts/omniproject/src/components/reports/ScheduleSandbox.tsx:55` | `computeSchedule` memoized on `shifts`, which changes every pointer-move → full cascade solver per frame | rAF-coalesce `setShifts`, or debounce recompute with ref-driven visual position |
| `artifacts/omniproject/src/lib/monte-carlo.ts:120` | S-curve re-scans sorted totals per bucket → 41×20,000 = 820k comparisons on the main thread on every slider drag | Two-pointer merge over monotonic `sorted`+thresholds → ~20k; binary search for `belowPlan` |
| `artifacts/omniproject/src/components/reports/DependencyLinks.tsx:69` | Drift recompute `await`s SHA-256 per edge sequentially in a `for` loop | `await Promise.all(edges.map(...))` — independent `crypto.subtle.digest`s |

### Theme E — Quadratic algorithms on portfolio-scale inputs
_Fine per-project; bite hard on the cross-programme graph (thousands of nodes/edges)._

| File:line | Complexity | Fix |
|---|---|---|
| `artifacts/omniproject/src/components/reports/CrossProgrammeDependencies.tsx:85` | `map.edges.some(...)` per node → O(nodes × edges) over whole portfolio graph | Reuse the already-built `graphIds` Set: `criticalSet.has(n.id) \|\| endpointSet.has(n.id)` → O(n) |
| `artifacts/omniproject/src/lib/critical-path.ts:83` | Kahn sort uses `queue.shift()` (O(n)) → O(V²); this is the **shared** solver over the whole portfolio graph | Head-index pointer `queue[head++]` → amortized O(V+E). Same fix in `schedule-scenario.ts:151` |
| `artifacts/omniproject/src/components/views/ScrumView.tsx:82` | `model.sprint.filter` inside `SPRINT_COLUMNS.map` → O(columns × sprint)/render | Group once in the `model` useMemo → `Map<status, Issue[]>` |
| `artifacts/omniproject/src/lib/schedule-scenario.ts:161` | Cycle recovery uses `order.includes(id)` in a loop → O(n²) | Build a `Set` of ordered ids once |
| `artifacts/omniproject/src/lib/resource-load.ts:41` | `peakFor` filters whole task list per start day → O(n²)/person (paid twice per drag) | Sweep line over sorted start/end events → O(n log n) when per-person counts grow |

### Theme F — Redundant work per request (double fetch / double serialize / re-lookup)
| File:line | What happens | Fix |
|---|---|---|
| `artifacts/api-server/src/routes/export.ts:49` | `getProjects(req)` fetched twice per xlsx export (line 49 + inside `allIssues`) — whole portfolio pulled twice | Fetch once, pass into `allIssues(req, projects)` |
| `artifacts/api-server/src/broker/cache.ts:93` | Cache + single-flight each independently `JSON.stringify` the same args on a miss (cache.ts:93 then single-flight.ts:47) | One shared `readKey(method,args)` threaded through both layers |
| `artifacts/api-server/src/lib/capabilities.ts:216` | `resolveCapabilities` awaits 3 independent broker probes sequentially (waterfall) | `Promise.all([...])` keeping per-call `.catch` fallbacks — pays 1 latency not 3 |
| `artifacts/api-server/src/routes/rate-card.ts:235` | `staff-cost` pulls full 200-project list to read one project's `programmeId` | Single-project/summary accessor |
| `artifacts/api-server/src/routes/rate-card.ts:46` | `getSession(req)` called twice per audit record (+ `!` foot-gun); recurs across tools/security/snapshots/features/mcp | `const s = getSession(req)` once |
| `artifacts/api-server/src/lib/column-mapper.ts:113` | `scoreHeader` re-normalizes registry fields + rebuilds bigram maps per header | Precompute normalized/bigram registry view once before `headers.map()` |

### Theme G — Linear `.find` where a Map belongs (O(1) lookups)
| File:line | Fix |
|---|---|
| `lib/backend-catalogue/src/view-catalogue.ts:39` (+ `report-catalogue.ts:68`, `screen-catalogue.ts:48`, `methodology-catalogue.ts:55`, `widget-catalogue.ts:30`, `notification-kinds.ts:31`) | These take no overlay — build `id→def` Map once at module load, mirroring `methodology-rulesets.ts` `byId` precedent |
| `lib/backend-catalogue/src/broker-catalogue.ts:120` | `brokerSupportUnion` resolves each id via linear `.find` + throwaway `Object.fromEntries` → OR capability keys off a shared id→def map |
| `lib/backend-catalogue/src/report-catalogue.ts:84` (+ `screen-catalogue.ts:65`) | `availableReports` defensive-copies every report then filters most away → filter first, copy survivors |
| `artifacts/api-server/src/lib/rate-card-store.ts:115` | `valueModelFor` linear `.find` over projectTypes per project → build `Map<id, ProjectType>` in cached state |

### Theme H — Hot-path allocation (throwaway closures / arrays / spreads)
| File:line | What happens | Fix |
|---|---|---|
| `artifacts/api-server/src/broker/single-flight.ts:46` | Proxy `get` allocates a fresh wrapper closure + re-runs `Reflect.get`/`READ_METHODS.has`/`typeof` on **every** method access | Memoize wrapper per prop in a `Map<PropertyKey, Function>`. **Same fix:** `provenance.ts:44`, `cache.ts:79`, `messy-broker.ts:45`, `key-guard.ts:28`, `vendor-profile.ts:65` — every broker read passes ≥2 of these |
| `artifacts/omniproject/src/lib/forecast-curve.ts:79` | `Math.min(...starts)`/`Math.max(...ends)` spreads unbounded arrays → allocation **and latent stack-overflow crash** past ~65–120k args | Track running min/max in the existing loop. Same in `schedule-scenario.ts:200/217`, `benefits-realisation.ts:143` |
| `artifacts/omniproject/src/components/board/GanttChart.tsx:98` | `Math.min(...lanes.map(...))` allocates two throwaway arrays + spreads | Single fold over `lanes` |
| `artifacts/omniproject/src/components/dashboard/widgets.tsx:48` | `StatusBreakdownWidget` builds Map + sorts every render (re-runs when any sibling widget settles) | `useMemo(..., [projects])` |
| `artifacts/omniproject/src/pages/Programmes.tsx:47` | `standalone` filters all projects every render | `useMemo` keyed on `projects` |

### Theme I — SPA eager-mount query storms
| File:line | What happens | Fix |
|---|---|---|
| `artifacts/omniproject/src/pages/Settings.tsx:309` | ~30 admin panels mount eagerly → ~30 concurrent queries + huge initial commit on nav to Settings | Lazy-mount offscreen sections (intersection/accordion/tabs); query only when opened |
| `artifacts/omniproject/src/pages/Reports.tsx:121` | ~25 report components mount at once, each a portfolio aggregation query → storm on load + on every project-select | `React.lazy` + Suspense / intersection-observer for below-fold reports |

### Theme J — Memory unboundedness
| File:line | What happens | Fix |
|---|---|---|
| `artifacts/api-server/src/lib/read-cache.ts:35` | `ReadCache` has TTL but no size bound / no sweep — write-once-never-read keys stay resident forever; grows with total distinct keys, not working set | Add max-entries LRU cap or periodic sweep of expired entries on `set()` |

### Theme K — Type-design & correctness-adjacent design (maintainability)
| File:line | What happens | Fix |
|---|---|---|
| `artifacts/api-server/src/broker/registry.ts:98` | `CommandIntent.capability` is free `string`; a typo compiles and silently routes to primary | Type as `(typeof BROKER_CAPABILITY_KEYS)[number]` — compile-time exhaustiveness |
| `lib/backend-catalogue/src/screen-catalogue.ts:16` | RBAC role union re-declared in 3 places and **already drifted** (`"pmo"` accepted by verifier, absent from `ScreenCapabilities`/`NotificationAudience`) | One exported `Role` type + `ROLES` array as source of truth, reused in all three |
| `artifacts/omniproject/src/pages/Programmes.tsx:15` | `RAG_DOT`/`RAG_TEXT` are `Record<string,string>` → unknown status yields `undefined` className silently (dup in `ProgrammeDetail.tsx:25`) | `Record<RagStatus, string>` + typed `ragStatus` |
| `artifacts/omniproject/src/pages/MyWork.tsx:129` | `LiveEvent` read via `(n as Record<string,unknown>)["message"]` casts | Discriminated union on `kind` with typed payloads |
| `artifacts/omniproject/src/pages/MyWork.tsx:126` | Inbox uses array index as React key while `dismiss` removes by index → keys shift, React mis-associates DOM/state | Stable `id` per `LiveEvent` (synthesize at ingest), key on it |
| `artifacts/omniproject/src/pages/ProjectDetail.tsx:32` | Detail page pulls full 200-project list + O(n) `find` to render one header; header blank until list resolves | get-project-by-id read; decouple from index query |
| `artifacts/api-server/src/broker/cache.ts:54` | `invalidateReadCache()` clears only last-wrapped cache (module-level `activeClear` overwritten) | Track clear hooks in a `Set`, fan out invalidation |
| `artifacts/api-server/src/routes/index.ts:127` | `requireAuth` passed per-router ~30× — easy to forget on a new router | Register `router.use(requireAuth)` once after public routers, mount protected routers plainly |
| `lib/backend-catalogue/src/entity-resolution.ts:47` | `dedupeEntities` encodes "no key" as `" anon:N"` string sentinel → a real key starting `" anon:"` gets misclassified | Track anon-ness out of band (`Set` of synthetic keys / boolean) |

### Theme L — Feed/query materialization
| File:line | What happens | Fix |
|---|---|---|
| `artifacts/api-server/src/routes/odata.ts:80` | `applyODataQuery` materializes the entire dataset before `$filter`/`$top`/`$skip` → `$top=50` still flattens every issue across 200 projects | Push down `projectId` filter / honour `$top` before fan-out; short-circuit small `$top` |

## 4. Top 15 by ROI

Ranked by (impact-at-scale × inverse effort). **Win type:** 🟢 user-perceptible responsiveness · 🔵 backend/network throughput · 🟣 maintainability/latent-crash.

| # | Win | File:line | Sev | Effort | Why it pays |
|---|---|---|---|---|---|
| 1 | 🟢🔵 | `components/reports/use-portfolio-items.ts:30` (+4 dups) | med | XS | One `combine` fix kills a busted memo replicated 5× — stops O(200) aggregations on every unrelated render across the whole reports surface |
| 2 | 🟢 | `components/board/AgileBoard.tsx:173` | high | S | Removes an O(columns×issues) re-filter **per drag-hover frame** — the most visible board jank |
| 3 | 🔵 | `broker/single-flight.ts:46` (+5 dups) | high | S | Memoize proxy wrappers — every broker read (always-on layer) stops allocating throwaway closures; pure GC relief on the hottest path |
| 4 | 🔵 | `lib/feature-modules.ts:248` | high | S | Stops rebuilding the entire governance catalogue on every gated request; O(catalogue)→O(1) feature check |
| 5 | 🟢 | `components/reports/CrossProgrammeDependencies.tsx:85` | high | XS | Reuse existing `graphIds` Set → O(n×e)→O(n) on the biggest report's dominant cost |
| 6 | 🔵 | `lib/explore-replica.ts:185` | high | M | 1,400 serial round-trips (~3 min) → seconds via inner `Promise.all` + bounded outer pool |
| 7 | 🟢🔵 | `pages/MyWork.tsx:35` | high | M | Replace 200-way fetch herd with a single "assigned to me" read — unblocks the browser connection pool on tab open |
| 8 | 🟢 | `lib/monte-carlo.ts:120` | high | S | Two-pointer S-curve: 820k→~20k comparisons; removes slider-drag jank on the main thread |
| 9 | 🔵 | `broker/registry.ts:127` | high | S | Hoist loop-invariant + memoize `connectedBrokers()` → O(n²)→O(n) routing on every write dispatch |
| 10 | 🔵 | `catalogue/component-library.ts:90` | high | S | Build `LIBRARY` + `Map` once → O(components) rebuild per lookup → O(1); hits every dashboard/report render |
| 11 | 🟣 | `lib/forecast-curve.ts:79` (+2 dups) | med | XS | Fold min/max into existing loop — removes allocation **and a latent stack-overflow crash** on large programmes |
| 12 | 🔵 | `routes/odata.ts:62` + `export.ts:32` | med | S | One shared bounded `allIssues` helper caps 200-way fan-out on every feed poll / export; removes duplication |
| 13 | 🟢 | `pages/Reports.tsx:121` + `Settings.tsx:309` | med | M | Lazy-mount below-fold panels → page paints fast instead of firing 25–30 heavy queries on load |
| 14 | 🟢 | `lib/critical-path.ts:83` (+ schedule-scenario:151) | med | XS | One-line head-index queue → O(V²)→O(V+E) in the shared portfolio-graph solver |
| 15 | 🟣 | `catalogue/screen-catalogue.ts:16` | med | S | Single `Role`/`ROLES` source of truth fixes an **already-live drift** (`"pmo"` passes verifier, violates type) |

_Honourable mentions just outside the 15:_ `lib/i18n.tsx:220` (unmemoized provider value re-renders whole tree; dups in `a11y-prefs.tsx:167`, `platform-context.tsx:66`), `lib/global-search.ts:33` (per-keystroke re-lowercase/split of all rows), `lib/capabilities.ts:216` (3-probe waterfall → `Promise.all`), `lib/read-cache.ts:35` (unbounded cache), `view-catalogue.ts:39` family (linear `.find`→Map).

## 5. Patterns to adopt

These codify the fixes above into standing rules so the anti-patterns stop reappearing:

1. **Never fan out over the portfolio unbounded.** Any `Promise.all`/`useQueries` over "all projects" must go through a shared bounded-concurrency helper (target 6–12 in flight). Better: prefer a dedicated aggregate/search read at the seam over N per-project reads. _Codify one `boundedAll()` util (server) and standardize `useQueries` pools (SPA)._
2. **Static-over-imports ⇒ compute once at module scope.** Catalogues, capability tables, role/env parses, and library derivations are invariant. Build them lazily-once (module const or memo-on-raw-value for env, preserving hot-reload). Follow the existing `methodology-rulesets.ts` `byId` precedent everywhere.
3. **`useQueries` returns a fresh array — use `combine`.** Any derivation off query results must use React Query's `combine` (memoized on underlying results) or key on a stable data signal, never on the results-wrapper array. This is the #1 jank source; make it a lint-reviewed rule.
4. **Gesture-driven state is ref-first.** Pointer-move handlers update a CSS var / transform via ref during the gesture and commit to React state only on pointer-up (or rAF-coalesce). No O(all-items) pass should run per pointer event.
5. **`id → def` lookups are Maps, not `.find`.** Any getter that resolves by id over a static list uses a prebuilt Map. Filter-then-copy (never copy-then-filter) for defensive clones.
6. **Compute each key/derivation once per logical operation.** Thread derived values (read keys, projects list, session) through stacked layers instead of recomputing per layer. Bind `const s = getSession(req)` once.
7. **Never spread an unbounded array into `Math.min/max/apply`.** Fold into the loop that already built it — it's both an allocation and a latent stack-overflow.
8. **One source of truth per enum/union.** Roles, RAG bands, capability keys, event kinds: one exported type + array, reused at every boundary and typed at the edges (no `Record<string, …>` for closed sets, no in-band string sentinels).
9. **Caches need bounds.** Any TTL cache also needs a size cap or sweep so memory tracks the working set, not total distinct keys seen.
10. **Prefer O(V+E) graph solvers.** Head-index queues (not `shift()`), Sets for membership, sweep-lines for overlap — the shared solvers run on the one genuinely large input (the cross-programme graph).
