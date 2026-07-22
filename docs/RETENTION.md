# Retention — durable time-series for tracking + trend analysis

The self-host DB (or any retention source) lets OmniProject **retain a time-series** of work-item
state, so tracking and trend analysis stop depending on whatever history a source tool happens to
keep. This is the layer that turns the existing trend reports (health trajectory, EVM over time,
benefit realisation, flow) from *snapshots* into *trajectories*.

This doc covers both halves of the subsystem: the **retention engine** (journal → snapshot → trend)
and the **cloud connectors** (S3 / DynamoDB / BigQuery) that implement its storage seam.

> **Statelessness preserved.** The gateway still holds nothing. All retained data lives BELOW the
> composition seam, in the retention **source**. The gateway only computes over what the source
> returns. The `guard-zero-at-rest-above-seam` CI guard enforces this — nothing above the seam imports
> a persistence layer (or a cloud SDK).

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

> **Capture is not yet auto-wired.** The `write ─▶ diffToJournal` arrow above is the *designed* flow, but
> the gateway does not yet call the write-path glue (`recordWrite`) from its write routes — see
> **"What ships vs. what follows"** below. So today, even with a `RetentionSource` configured, nothing
> populates the journal from app writes and the trends API answers the honest `available: false`
> ("history not yet retained"). The read/compute half (snapshot → `computeSeries` → trend) and the
> Project Health chart are shipped and correct; they light up once capture is wired (the self-host DB work).

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

`resolveCadence(config, scope)` = **project override ▸ programme override ▸ org default**. Persisted as
the scope-layered **`history-retention` config def** (`{ orgDefault, programme{}, project{}, disposal,
legalHolds }`) in the composition model — no longer a `SettingsState` key (`lib/history-retention.ts`
owns the type, default, `sanitizeHistoryRetention`, and `resolveHistoryRetention`). Edited via
`PUT /api/history/retention` — **admin** owns the org default (and any scope), a **PMO** may set
programme/project overrides but not the org default (403 otherwise).

> **Shortening retention is floor-gated (Phase C).** Because a shorter disposal window / cadence
> relaxes a data-governance guarantee, `history-retention` is a **security-classified config**: the
> write path (`applyConfigCollectionGuarded`) reads the currently-resolved value and, if the new value
> **shortens** retention, seals the write into a sign-off proposal (`202`, held) instead of applying it
> immediately; lengthening (tightening) applies straight away. See
> [FEATURE-ROADMAP.md](FEATURE-ROADMAP.md) Phase C for the floor-gate mechanism.

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

## Cloud connectors — S3, DynamoDB, BigQuery (and friends)

The `RetentionSource` seam has ready-made **cloud connectors** for the common managed stores, so an
operator can keep the journal + snapshots wherever they already run.

> **The gateway imports no cloud SDK.** Each connector is **pure key-layout + query logic over an
> injected client port** — the same pattern as the self-host DB's `SelfHostDbPort`. The SDK-backed
> port (the thing that actually calls S3/DynamoDB/BigQuery) lives in the operator's **broker/boot
> layer**, below the seam. `guard-zero-at-rest-above-seam` forbids importing any of these SDKs above
> the seam, so this separation can't rot.

| Connector | Fits | Port it needs | Layout |
| --- | --- | --- | --- |
| `objectStoreRetentionSource` | **AWS S3**, GCS, Azure Blob, MinIO | `ObjectStorePort` (`put`/`get`/`list`) | `journal/{entity}/{id}/{changedAt}#{txn}#{field}.json`, `snapshot/{entity}/{id}/{asOf}.json` — lexical order = time order, so a prefix list is a time scan. |
| `tableStoreRetentionSource` | **AWS DynamoDB**, Azure Cosmos, Cassandra | `TableStorePort` (`putItem`/`query`) | Single table: `PK={entity}#{id}`, `SK=SNAP#{asOf}` \| `JRNL#{changedAt}#{txn}#{field}`. Window = SK range query; `lastSnapshotAt` = descending limit-1. |
| `warehouseRetentionSource` | **GCP BigQuery**, Snowflake, Redshift | `WarehousePort` (`insertRows`/`query`) | Two append-only tables (`journal`, `snapshot`); reads use **bound `@params`** (never interpolated values). |

Each returns a `RetentionSource` with the full contract, so the trends API and `recordWrite` treat
them identically. Retention stays **infinite**; snapshots are derived from the append-only journal.

### Wiring — the retention-broker process (shipped)

The SDK-backed ports are shipped as a **standalone service**, `services/retention-broker`, so the
cloud SDK runs in its OWN process — a package boundary alone wouldn't keep the SDK out of the gateway
process, only a process boundary does. The gateway talks to it over HTTP:

```
gateway (zero-at-rest)            services/retention-broker            cloud store
  BrokerRetentionSource ──HTTP──▶ /retention/<op> ──▶ SDK port ──▶ S3 / DynamoDB / BigQuery
   (history/broker-source.ts,      (ports/{s3,dynamo,bigquery}.ts,
    no SDK)                         shared pure connector algebra)
```

- **Gateway side** (`artifacts/api-server/src/history/broker-source.ts`) — `brokerRetentionSource`
  implements `RetentionSource` by POSTing to `/retention/<op>`; no cloud SDK. Registered at boot from
  `RETENTION_BROKER_URL` (+ optional `RETENTION_BROKER_TOKEN`); a no-op when unset, so the trend API
  stays honest ("history not yet retained").
- **Broker side** (`services/retention-broker`) — a tiny HTTP service that picks a backend from
  `RETENTION_BACKEND` (`s3` | `dynamodb` | `bigquery`), builds a `RetentionSource` from the SDK port +
  the **same pure connector algebra** the gateway defines (imported, one source of truth for the
  key/query layout), and serves the ops. See its `README.md`.

Run it and point the gateway at it (compose sketch):

```yaml
services:
  retention-broker:
    build: { context: ., dockerfile: services/retention-broker/Dockerfile }
    environment:
      RETENTION_BACKEND: s3
      RETENTION_S3_BUCKET: my-omni-history
      AWS_REGION: us-east-1
      RETENTION_BROKER_TOKEN: "${RETENTION_BROKER_TOKEN:?openssl rand -hex 24}"
  omni-shell:
    environment:
      RETENTION_BROKER_URL: "http://retention-broker:8090"
      RETENTION_BROKER_TOKEN: "${RETENTION_BROKER_TOKEN}"
```

The service is **not** part of the pnpm workspace — its cloud SDKs are isolated in its own
`package.json`, so they never touch the monorepo install or the `minimumReleaseAge` supply-chain
guard. It has its own CI job (`retention-broker`) that installs + typechecks + tests it offline (the
SDK clients are faked).

### Choosing a store

- **Object store (S3/GCS/Blob)** — cheapest, simplest, effectively unbounded; ideal for the
  **infinite snapshot** posture. Best default for most deployments.
- **Table store (DynamoDB/Cosmos)** — low-latency point reads + range scans; good when trends are read
  hot and per-entity.
- **Warehouse (BigQuery/Snowflake)** — when history also feeds BI/analytics; the trend maths still
  runs in `computeSeries`, so the warehouse only stores + returns rows.

### Third-party backend history

A connector is **optional**. If a connected 3rd-party backend already retains history, point the
`RetentionSource` provider at the **broker** instead (the existing `GET /history/replay` reads
recorded state through it) — no cloud store of your own required. Adopting the self-host DB or a
connector is only for deployments whose source tool keeps too little history.

## What ships vs. what follows

- **Shipped:** the pure retention engine (journal → snapshot → cadence → trend), the `RetentionSource`
  seam + provider registry, the settings + admin/PMO cadence gating, the trends API, the SPA hook +
  chart wired into Project Health, and the cloud connectors + retention-broker process. Fully tested
  (node:test + vitest; connectors via in-memory port doubles).
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
- **Testing.** Every connector is unit-tested with an **in-memory port double** (no SDK, no network) —
  round-tripping journal + snapshots, window filtering, multi-id fan-out, and `lastSnapshotAt`. The
  SDK-backed ports are integration-tested against the live service (or a local emulator: MinIO /
  DynamoDB Local / the BigQuery emulator) in the broker/boot layer, out of the gateway's unit suite.
