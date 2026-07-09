# History retention — durable time-series for tracking + trend analysis

The self-host DB (or any retention source) lets OmniProject **retain a time-series** of work-item
state, so tracking and trend analysis stop depending on whatever history a source tool happens to
keep. This is the layer that turns the existing trend reports (health trajectory, EVM over time,
benefit realisation, flow) from *snapshots* into *trajectories*.

> **Statelessness preserved.** The gateway still holds nothing. All retained data lives BELOW the
> composition seam, in the retention **source** (the self-host DB, via the broker's parameterised
> SQL). The gateway only computes over what the source returns. The `guard-zero-at-rest-above-seam`
> CI guard enforces this — nothing above the seam imports a persistence layer.

## Operator-confirmed decisions

1. **Infinite snapshot retention.** Snapshots are **never pruned**. A snapshot is derived from the
   append-only journal, so it is cheap to keep indefinitely (it's just the journal's running state).
2. **Variable cadence, gated by admin + PMO.** How often a snapshot is materialised is configurable,
   not a fixed daily job: **admin** sets the org default; **PMO** overrides per programme/project.
   Most-specific scope wins — exactly like feature governance.
3. **v1 trend scope:** health trajectory (completion + open blockers) is wired into the Project Health
   report now; EVM-over-time, benefit realisation, and flow (throughput / cycle time) are supported by
   the engine and exposed via the trends API, ready to wire into their existing reports next.

## The model — one journal, derived snapshots

```
write ─▶ diffToJournal ─▶ issue_history        (append-only: one row per field change)
                              │
                      materialiseSnapshot        (fold journal ≤ asOf)
                              ▼
                        entity_snapshot          (point-in-time; infinite retention)
                              │
        computeSeries(metric, window, grain) ─▶ TrendSeries ─▶ trend reports
```

- **Change journal** (`issue_history`) — the raw truth. `diffToJournal` emits one row per genuinely
  changed field on each write (0/false/"" are real values; structural values diff by deep equality),
  sharing a `txnId` so a snapshot boundary is a whole transaction. Nothing is ever overwritten.
- **Snapshot** (`entity_snapshot`) — `materialiseSnapshot` folds the journal up to an `asOf`. It's a
  materialised **cache** of the journal, so keeping it forever is cheap and it can always be rebuilt.
- **Trend series** — `computeSeries` buckets snapshots by grain (day/week/month/quarter), takes each
  entity's **as-of** state at the bucket's end, extracts the metric, and rolls entities up (mean or
  sum). A bucket with no observations is a **null gap**, not a zero — the chart never implies data.

## Cadence (variable, gated)

`SnapshotCadence` is one of:

- `onWrite` — a snapshot at every transaction boundary (highest fidelity);
- `interval { everyHours }` — a fixed cadence (e.g. 24 = daily);
- `manual` — no automatic snapshots (a **baseline capture always forces one** regardless, so
  variance trends still get their on-baseline points).

`resolveCadence(config, scope)` = **project override ▸ programme override ▸ org default**. Persisted in
`settings.historyRetention` (`{ orgDefault, programme{}, project{} }`); edited via
`PUT /api/history/retention` — **admin** owns the org default (and any scope), a **PMO** may set
programme/project overrides but not the org default (403 otherwise).

## Metrics supported

`completionPct`, `openBlockers`, `cpi`, `spi`, `estimateAtCompletion`, `costVariance`,
`scheduleVariance`, `benefitRealisedPct` (direct or derived from planned/actual), `openRisks`,
`cycleTimeDays`, `throughput`. Each maps to the canonical field vocabulary, so the same superset a
backend maps onto is what a trend charts.

## Seams

- **`RetentionSource`** (`history/retention.ts`) — the injectable store contract: `readSnapshots`,
  `readJournal`, `appendJournal`, `writeSnapshot`, `lastSnapshotAt`. The gateway registers a
  *provider* (`scope → source | null`); when none is configured the trend API answers
  `available: false` with a reason (the honest "history not yet retained"), never fabricated data.
  Tests inject an in-memory source; production injects the self-host source (below the seam).
- **`recordWrite`** — the write-path glue: append the diff to the journal and, if the cadence is due,
  materialise + persist a snapshot. Pure orchestration over the injected source.
- **Trends API** — `GET /api/history/trends/:metric?grain&programmeId&projectId&entity&ids&from&to`,
  gated on the self-host `history` domain being enabled for the scope. Returns a `TrendSeries`.
- **SPA** — `useTrend(query)` + the dependency-free `<TrendChart>` (inline SVG; null points break the
  line; unavailable → honest note). Wired into the Project Health report as **Health trajectory**.

## What ships in this PR vs. what follows

- **This PR:** the pure retention engine (journal → snapshot → cadence → trend), the `RetentionSource`
  seam + provider registry, the settings + admin/PMO cadence gating, the trends API, and the SPA hook
  + chart wired into Project Health. Fully tested (node:test + vitest).
- **Follows (with the self-host SQL work in [SELF-HOST-DB.md](SELF-HOST-DB.md)):** the concrete
  `RetentionSource` backed by the parameterised-SQL broker workflow, the `issue_history` /
  `entity_snapshot` DDL (generated additively from `fields.json`), and wiring `recordWrite` into the
  self-host adapter's write path. Then EVM-over-time / benefit-realisation / flow panels into their
  existing reports.

## Honest limits

- **No source ⇒ no trend.** Without a retention source the API is honest (`available: false`); it
  never invents history. Connecting a history-bearing backend, enabling the self-host `history`
  domain, or the logging-sync time-travel egress are the ways to populate it.
- **Snapshots are a cache, journal is truth.** A snapshot can always be rebuilt from the journal, so
  "infinite retention" is bounded by journal size, not snapshot count.
- **Cadence governs write frequency only** — never retention (which is infinite) and never read
  fidelity (the journal captures every change regardless of snapshot cadence).
