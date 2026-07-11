# retention-broker

The **below-the-seam** service that gives OmniProject durable history a real home. It runs the cloud
SDKs (**S3 / DynamoDB / BigQuery**) that the gateway is forbidden to import, and exposes them over a
tiny HTTP contract the gateway's `BrokerRetentionSource` speaks. This is a **separate process** on
purpose: it keeps the gateway zero-at-rest and SDK-free (the `guard-zero-at-rest-above-seam` guard
enforces it), while persistence lives here.

It is **not** part of the pnpm workspace — its heavyweight, fast-moving cloud SDKs are isolated in its
own `package.json` / `node_modules`, so they can't affect the monorepo's install or the
`minimumReleaseAge` supply-chain guard.

## How it fits

```
gateway (zero-at-rest)         retention-broker (this service)        cloud store
  BrokerRetentionSource ──HTTP──▶ /retention/<op> ──▶ SDK port ──▶ S3 / DynamoDB / BigQuery
   (no SDK)                        objectStore/tableStore/warehouse
                                   RetentionSource (shared pure algebra)
```

The key/query **layout** is the gateway's pure connector algebra
(`artifacts/api-server/src/history/connectors`), imported here so both sides agree byte-for-byte —
a broker that laid out S3 keys differently would silently corrupt reads.

## Run

```bash
cd services/retention-broker && npm install
RETENTION_BACKEND=s3 RETENTION_S3_BUCKET=my-omni-history AWS_REGION=us-east-1 \
  RETENTION_BROKER_TOKEN=$(openssl rand -hex 24) npm start
```

Then point the gateway at it: `RETENTION_BROKER_URL=http://retention-broker:8090` (and
`RETENTION_BROKER_TOKEN=<same>`).

## Config

| Backend | `RETENTION_BACKEND` | Required | Creds |
| --- | --- | --- | --- |
| AWS S3 (or GCS/Blob/MinIO via `S3_ENDPOINT`) | `s3` | `RETENTION_S3_BUCKET`, `AWS_REGION` | IRSA / instance role / `S3_ENDPOINT` for MinIO |
| AWS DynamoDB | `dynamodb` | `RETENTION_DDB_TABLE`, `AWS_REGION` | IRSA / instance role / `DYNAMODB_ENDPOINT` for Local |
| GCP BigQuery | `bigquery` | `RETENTION_BQ_DATASET`, `GOOGLE_CLOUD_PROJECT` | Workload Identity / ADC |

`RETENTION_BROKER_TOKEN` gates the `/retention/*` ops with a bearer token and is **required**: the
service refuses to boot without it, because those ops read/purge the entire durable history store. For
a loopback-only local run you can set `RETENTION_BROKER_ALLOW_ANON=1` to accept **unauthenticated**
requests (never in production; the service logs a warning). `HOST` defaults to `0.0.0.0` (set it to
`127.0.0.1` to bind loopback only) and `PORT` defaults to 8090.

## Test

```bash
npm test        # node:test, fully offline — SDK clients are faked, no cloud/network
npm run typecheck
```

Live integration against real services (or emulators: MinIO / DynamoDB Local / the BigQuery emulator)
is out of the offline unit suite — set the env above and hit `/healthz` + a round-trip.
