# attachments-broker

The **below-the-seam** service that gives OmniProject file attachments a real home. It holds the file
**bytes** that the gateway is forbidden to store (the `guard-zero-at-rest-above-seam` guard enforces
that the gateway imports no object-store SDK and persists nothing above the broker seam), and exposes
them over a tiny HTTP contract. This is a **separate process** on purpose: the gateway keeps only a
small *pointer* record (id, filename, content-type, size, sha256, key, author, timestamp — never
bytes); the bytes live here.

It is **not** part of the pnpm workspace and has **zero runtime dependencies** — node built-ins only
(`node:http`, `node:crypto`, `node:fs`) — so there is no third-party supply-chain surface to audit and
nothing to `npm install`.

## How it fits

```
gateway (zero-at-rest)          attachments-broker (this service)      volume
  attachments client  ──HTTP──▶  /blob/<key>  ──▶  filesystem store  ──▶  /data
   (pointer only, no bytes)       (bearer-gated)                          (bytes live only here)
```

The gateway mints a storage `key`, stores the pointer record, and streams the bytes to `/blob/<key>`
(bearer-authenticated, egress-guarded). A later, additive backend can swap the filesystem store for a
cloud object store (S3/GCS/Azure) behind the same interface, exactly as the retention-broker layers its
SDK ports — the point is that the byte-holding SDK never crosses the seam into the gateway.

## Contract

| Method | Path | Auth | Result |
| --- | --- | --- | --- |
| `GET` | `/healthz` | none | `{ ok: true }` (liveness) |
| `PUT` | `/blob/<key>` | bearer | store bytes → `{ ok, key, size, sha256 }` |
| `GET` | `/blob/<key>` | bearer | `application/octet-stream` (404 if absent) |
| `HEAD` | `/blob/<key>` | bearer | `200` / `404` |
| `DELETE` | `/blob/<key>` | bearer | `{ ok }` / `404` |

A `<key>` is a flat, path-traversal-safe token (`[A-Za-z0-9._-]{1,200}`, no `/`, no `..`). Uploads past
`ATTACHMENTS_MAX_BYTES` (default 25 MB) are rejected `413`.

## Run

```bash
cd services/attachments-broker
ATTACHMENTS_BROKER_TOKEN=$(openssl rand -hex 24) ATTACHMENTS_BROKER_DIR=./data npm start
```

Then point the gateway at it (a later slice wires this): `ATTACHMENTS_SIDECAR_URL=http://attachments-broker:8091`
and `ATTACHMENTS_SIDECAR_TOKEN=<same>`.

## Config

| Env | Default | Notes |
| --- | --- | --- |
| `ATTACHMENTS_BROKER_TOKEN` | — | **Required.** Bearer token gating `/blob/*`. The service refuses to boot without it. |
| `ATTACHMENTS_BROKER_ALLOW_ANON` | — | Set `1` to accept **unauthenticated** requests (loopback-only dev; never production — logs a warning). |
| `ATTACHMENTS_BROKER_DIR` | `/data` | The writable volume the bytes live in. Mount it; the container root FS can stay read-only. |
| `ATTACHMENTS_MAX_BYTES` | `26214400` | Max upload size (bytes). |
| `HOST` | `0.0.0.0` | Set `127.0.0.1` to bind loopback only. |
| `PORT` | `8091` | Listen port. |

## Test

```bash
npm test        # node:test, fully offline — a real server on an ephemeral port, temp-dir store
```
