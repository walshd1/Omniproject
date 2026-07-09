# Retention connectors — S3, DynamoDB, BigQuery (and friends)

The history-retention layer ([HISTORY-RETENTION.md](HISTORY-RETENTION.md)) reads and writes through a
single `RetentionSource` seam. This doc covers the **cloud connectors** that implement that seam for
the common managed stores, so an operator can keep the journal + snapshots wherever they already run.

> **The gateway imports no cloud SDK.** Each connector is **pure key-layout + query logic over an
> injected client port** — the same pattern as the self-host DB's `SelfHostDbPort`. The SDK-backed
> port (the thing that actually calls S3/DynamoDB/BigQuery) lives in the operator's **broker/boot
> layer**, below the seam. The `guard-zero-at-rest-above-seam` CI guard forbids importing any of these
> SDKs above the seam, so this separation can't rot.

## The three connectors

| Connector | Fits | Port it needs | Layout |
| --- | --- | --- | --- |
| `objectStoreRetentionSource` | **AWS S3**, GCS, Azure Blob, MinIO | `ObjectStorePort` (`put`/`get`/`list`) | `journal/{entity}/{id}/{changedAt}#{txn}#{field}.json`, `snapshot/{entity}/{id}/{asOf}.json` — lexical order = time order, so a prefix list is a time scan. |
| `tableStoreRetentionSource` | **AWS DynamoDB**, Azure Cosmos, Cassandra | `TableStorePort` (`putItem`/`query`) | Single table: `PK={entity}#{id}`, `SK=SNAP#{asOf}` \| `JRNL#{changedAt}#{txn}#{field}`. Window = SK range query; `lastSnapshotAt` = descending limit-1. |
| `warehouseRetentionSource` | **GCP BigQuery**, Snowflake, Redshift | `WarehousePort` (`insertRows`/`query`) | Two append-only tables (`journal`, `snapshot`); reads use **bound `@params`** (never interpolated values). |

Each returns a `RetentionSource` with the full contract (`readSnapshots`, `readJournal`,
`appendJournal`, `writeSnapshot`, `lastSnapshotAt`), so the trends API and `recordWrite` treat them
identically. Retention stays **infinite**; snapshots are derived from the append-only journal.

## Wiring one up (boot layer)

```ts
import { registerRetentionProvider, objectStoreRetentionSource } from "./history";
import { s3ObjectStorePort } from "./boot/retention-ports"; // YOUR SDK-backed port (below the seam)

// One line at boot: point the deployment's retention at S3.
const source = objectStoreRetentionSource(s3ObjectStorePort({ bucket: process.env.RETENTION_BUCKET! }));
registerRetentionProvider(() => source);
```

The `*Port` implementation is the only place a cloud SDK appears. A reference example (per cloud)
belongs in the broker/sidecar image, not the gateway — keep it out of `artifacts/*/src`.

## Choosing a store

- **Object store (S3/GCS/Blob)** — cheapest, simplest, effectively unbounded; ideal for the
  **infinite snapshot** posture. Best default for most deployments.
- **Table store (DynamoDB/Cosmos)** — low-latency point reads + range scans; good when trends are read
  hot and per-entity.
- **Warehouse (BigQuery/Snowflake)** — when history also feeds BI/analytics; the trend maths still
  runs in `computeSeries`, so the warehouse only stores + returns rows.

## Third-party backend history

A connector is **optional**. If a connected 3rd-party backend already retains history, point the
`RetentionSource` provider at the **broker** instead (the existing `GET /history/replay` reads
recorded state through it) — no cloud store of your own required. Adopting the self-host DB or a
connector is only for deployments whose source tool keeps too little history.

## Testing

Every connector is unit-tested with an **in-memory port double** (no SDK, no network) — round-tripping
journal + snapshots, window filtering, multi-id fan-out, and `lastSnapshotAt`. The SDK-backed ports
are integration-tested against the live service (or a local emulator: MinIO / DynamoDB Local /
the BigQuery emulator) in the broker/boot layer, out of the gateway's unit suite.
