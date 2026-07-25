# Scaling & responsiveness

How OmniProject stays fast for users and gentle on the customer's backends as usage grows. Companion
to [`ops/MULTI-REPLICA.md`](./ops/MULTI-REPLICA.md) (horizontal scale + shared state).

## The shape of the problem

OmniProject is a **stateless overlay**: it forwards each user's token and, by default, makes a **live
backend call per read**. So load on the systems of record (Jira, OpenProject, ServiceNow, …) scales
with *users × surfaces × refreshes*. Those backends enforce their own API rate limits, so the real
scaling risk is **amplifying read fan-out** until upstream **429s** surface as slowness/errors.

Two different "rate limits" matter, and only one is a genuine ceiling:

- **OmniProject's own limiter** (`API_RATE_LIMIT_MAX`, default 300/15 min/user; Redis-shared under
  scale) — a knob *you* control. Tune it; it won't block adoption on its own.
- **The backends' limits** — the actual constraint. The mitigations below exist to keep OmniProject
  from amplifying load against them.

## What's already in place

- **Push, not poll.** Live updates ride SSE (`notify-hub` / `live-events`), so dashboards revalidate
  on change instead of on a timer.
- **Single-flight coalescing (always on).** Concurrent identical reads (same actor + method + args)
  share **one** upstream call — N users opening the same dashboard ⇒ 1 backend call, not N. No
  staleness (all callers get the one live result). See `broker/single-flight.ts`.
- **Opt-in TTL read cache.** `READ_CACHE_TTL_MS` serves repeat reads from memory for a few seconds —
  per-actor keyed, write-through invalidated, bounded + ephemeral. Trades "never stale" for latency;
  off by default. See `broker/cache.ts`.
- **Latency-aware adaptive TTL.** With `READ_CACHE_ADAPTIVE=true`, the cache tunes each method's TTL
  from its **measured** upstream latency (an EWMA recorded on every real miss). The model is combined:
  below a `READ_CACHE_ADAPTIVE_THRESHOLD_MS` the method is "already fast" and isn't cached at all;
  above it, `TTL = clamp(READ_CACHE_MIN_TTL_MS, READ_CACHE_MAX_TTL_MS, factor × latency)` — so a slow
  rollup caches longer (where caching pays off) and a cheap list isn't made stale for little gain. The
  `MAX` clamp is the explicit staleness ceiling. Cold start falls back to the baseline TTL. Each
  entry stamps the TTL chosen at fetch time, so a later tuning never retroactively extends it. See
  `broker/adaptive-ttl.ts`; surfaced in the dev-mode `brokerReads.cache.adaptive` posture.
- **Edge + transport:** gzip/brotli compression, immutable static-asset caching, route code-splitting.
- **Perceived latency:** optimistic edits + Undo, skeleton loaders, and read-ahead **prefetch**
  (deterministic on hover/focus for everyone; opt-in predictive tier). See `lib/prefetch.ts`.
- **Fleet scale:** the rate limiter and presence move to a shared **Redis** store when `REDIS_URL` is
  set, so ceilings hold across replicas (`ops/MULTI-REPLICA.md`).

## The plan (in priority order)

### 1. Gateway read-model cache — the #1 lever (largest follow-up)
Promote the opt-in TTL cache toward a first-class, **invalidation-driven** read cache so it can be the
default at scale without the staleness worry:
- Invalidate on the **webhook + SSE** change signals already flowing in, not just on TTL/write-through,
  so entries stay fresh and the TTL can be longer.
- Move the store behind the **Redis shared-state seam** so a cache fill on one replica serves the
  fleet.
- Keep the **per-actor / authz-aware** keying (never serve one user's data to another); cache only
  read-model GETs, never AI or gated actions.

Effect: *N users viewing the same project ⇒ ~1 upstream call per TTL window*, fleet-wide.

### 2. Upstream-aware backpressure (broker adapter)
Make the broker a good citizen of the backend's limits:
- Honour the backend's `Retry-After`; retry transient failures with **jittered backoff**.
- A per-backend **token-bucket / concurrency cap** so OmniProject never exceeds a backend's documented
  budget — a backend 429 is absorbed and smoothed, not amplified.

### 3. Cut N+1 fan-out
Aggregate rollups (portfolio health, programme summaries) so one screen is one (coalesced, cached)
call rather than a fetch per child. Route heavy/bulk consumers (BI) through the **OData feed +
scheduled exports** instead of live fan-out.

The sharpest instance is the **org-wide portfolio summary** (`computeLocalPortfolioSummary`): it fans
one broker call per project (financials + capacity), bounded to `PORTFOLIO_FANOUT_LIMIT = 10` combined
concurrency. Per programme (~hundreds of projects) that's fine; **org-wide at thousands of projects**
it is up to *N* upstream round-trips for a single request — the real ceiling, and only ever as fast as
the SoR.
- **Shipped (opt-in):** the whole computed summary is memoised through the shared `ReadCache`
  (`READ_CACHE_TTL_MS`), keyed by the caller's **resolved data scope** (never served across scopes) and
  the reporting-currency posture. So repeat org-wide loads within the TTL are one in-memory fold, not a
  fresh 5,500-way fan-out. Off by default (byte-identical when the TTL is unset); a hot instance sets a
  few seconds.
- **Planned (larger):** a periodic/incremental **materialized rollup snapshot** so even the first
  request in a window doesn't re-derive every project — the OData/BI/export seams are the right place to
  offload heavy analytical reads.

### 4. Config/def-store decrypt cache (server-side resolution)
Distinct from the *broker* read caches above: defs/config live as per-(type, scope) AES-256-GCM sealed
JSON blobs, and scope resolution (`resolveScopedConfig`, mappings, screens, vocabulary) reads them
through the one `readCollection` choke point — an **AES-decrypt + JSON-parse per call**. At many users'
worth of defs a single board render can re-decrypt the store repeatedly.
- **Shipped (opt-in):** `readCollection` consults a process-local **decrypted-collection cache keyed by
  file path + mtime + size** (`SEALED_READ_CACHE=true`). Because the key includes the file's mtime, the
  cache **self-invalidates on any write** — ours *or* another replica's on a shared volume — so it can
  never serve a stale def; a miss/stat-failure falls straight through to the full sealed read
  (fail-open to correctness). Returns a defensive copy so a read-modify-write caller can't mutate the
  cached snapshot. Off by default.
- Pairs with the existing write-path optimisation (one decrypt per write, fold the graph N times in
  memory) so both the read and write hot paths avoid repeated decrypts.

### 5. Durable store beyond sealed files (the datastore seam)
At high **write** concurrency, many replicas sealing the same `org.json` contend on one file
(last-write-wins via `rowVersion` + atomic rename is safe, but serialises). The per-(type, scope)
sharding already in place makes the migration clean: move the sealed-file store behind a **transactional
datastore or object store with per-scope keys**, keeping the same seal-at-rest posture. This is a
design, not a shipped change — see the archived **[RFC-003 (DB broker)](./archive/design/RFC-003-db-broker.md)**
for the storage-seam shape. Read-heavy deployments don't need it; it's the lever for write-heavy,
many-replica fleets.

## Responsiveness tweaks (frontend, mostly independent of backend load)

- **List virtualization** for the grid/board so a project with thousands of issues stays flat
  (`@tanstack/react-virtual`). Biggest single client-side win for large tenants.
- **`placeholderData: keepPreviousData`** on filtered/paginated queries (no empty-state flash).
- A sensible global **`staleTime`** so repeat navigations are instant-from-cache with background
  refresh (the SSE invalidation keeps it honest).
- **Abort in-flight fan-outs** (e.g. global search's per-project issue fetches) on close/retype.
- Extend **hover-prefetch** to nav links / breadcrumbs.

## Observability

The dev-mode debug bundle's `runtime-posture.json` reports `brokerReads` — single-flight `calls` vs
`coalesced`, and the read-cache `hits`/`misses` — so you can see how much upstream load is being
saved on a given instance, and the dev performance overlay surfaces `Server-Timing` per broker hop.

## Bottom line

The per-user limiter is tunable and not an adoption blocker. Backend limits **can** throttle adoption
if read fan-out grows naively — and the architecture already has the seams (single-flight shipped;
Redis shared-state, webhook/SSE invalidation, the broker adapter) to fix it **without** abandoning the
stateless, nothing-at-rest posture. The cache + backpressure work (items 1–2) is the investment to
plan before a large multi-tenant rollout.
