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

## Wiring — the retention-broker process (shipped)

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
