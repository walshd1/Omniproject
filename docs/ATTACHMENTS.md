# Attachments — the below-the-seam file-bytes sidecar

OmniProject is a **stateless, zero-at-rest overlay**: a CI guard (`guard-zero-at-rest-above-seam`) forbids
the gateway from importing any database/object-store SDK or persisting data above the broker seam. File
attachments therefore can't live in the gateway. Instead the bytes live in a **separate, loosely-coupled
sidecar** — [`services/attachments-broker`](../services/attachments-broker/README.md) — and the gateway
keeps only a small **pointer** record (never bytes). This mirrors the [retention-broker](./RETENTION.md)
pattern exactly.

> **Status:** the sidecar **service** and the **gateway pointer seam** ship now. The SPA attach/list/remove
> UI and the compose/Helm wiring land as follow-on slices; the design is
> [`docs/design/STATEFUL-SIDECAR.md`](./design/STATEFUL-SIDECAR.md).

## Why a sidecar (not the gateway)

```
gateway (zero-at-rest)          attachments-broker (below the seam)      volume
  pointer record only  ──HTTP──▶  /blob/<key>   ──▶  filesystem store  ──▶  /data
   {id,name,type,size,             (bearer-gated,                          (bytes live ONLY here)
    sha256,key,by,at}               egress-guarded)
```

- **The gateway stays byte-free.** It stores only the pointer (id, filename, content-type, size, sha256,
  storage key, author, timestamp) as coordination state — structurally identical to how comments ride the
  ephemeral `sharedKv` seam — and imports no object-store SDK, so `guard-zero-at-rest-above-seam` stays
  green.
- **The sidecar is hardened + isolated.** Its own process, its own image (digest-pinned, non-root,
  read-only root FS with only the `/data` volume writable), **zero runtime dependencies** (node built-ins
  only), and a bearer token that gates every `/blob/*` op. It refuses to boot without
  `ATTACHMENTS_BROKER_TOKEN`.

## The sidecar contract

| Method | Path | Auth | Result |
| --- | --- | --- | --- |
| `GET` | `/healthz` | none | `{ ok: true }` |
| `PUT` | `/blob/<key>` | bearer | `{ ok, key, size, sha256 }` |
| `GET` | `/blob/<key>` | bearer | `application/octet-stream` (404 if absent) |
| `HEAD` | `/blob/<key>` | bearer | `200` / `404` |
| `DELETE` | `/blob/<key>` | bearer | `{ ok }` / `404` |

Keys are flat, path-traversal-safe tokens (`[A-Za-z0-9._-]{1,200}`). Uploads past `ATTACHMENTS_MAX_BYTES`
(default 25 MB) are rejected `413`. Full config + run instructions:
[`services/attachments-broker/README.md`](../services/attachments-broker/README.md).

## Wiring sketch (compose)

Like the retention-broker, the sidecar ships as `services/` code with a copy-in compose sketch rather than
being force-added to a production compose file until the gateway seam lands:

```yaml
  attachments-broker:
    build: { context: ., dockerfile: services/attachments-broker/Dockerfile }
    image: omniproject-attachments-broker:0.1.0
    environment:
      ATTACHMENTS_BROKER_TOKEN: ${ATTACHMENTS_BROKER_TOKEN:?set a token}
    volumes:
      - attachments_data:/data
    read_only: true
    tmpfs: [/tmp]
    security_opt: [no-new-privileges:true]
    cap_drop: [ALL]
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8091/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 3s
      retries: 3
# volumes: { attachments_data: {} }
```

The gateway points at it with `ATTACHMENTS_SIDECAR_URL=http://attachments-broker:8091` +
`ATTACHMENTS_SIDECAR_TOKEN=<same>`, reached through the SSRF/egress guard like every other outbound hop.

## Gateway seam (shipped)

The `attachments` feature module (default-off; enable with `ENABLED_FEATURES=attachments`) exposes:

| Method | Route | Who | What |
| --- | --- | --- | --- |
| `GET` | `/api/attachments/:roomId` | any authed user (project-scoped) | list the room's pointers |
| `POST` | `/api/attachments/:roomId` | contributor+ | upload (raw body = bytes, `x-filename` header) |
| `GET` | `/api/attachments/:roomId/:id/blob` | any authed user (project-scoped) | download the bytes |
| `DELETE` | `/api/attachments/:roomId/:id` | the uploader, or pmo/admin | drop pointer + bytes |

On upload the gateway streams the bytes **straight through** to the sidecar (never persisting them),
computes the size + sha256, mints a storage key, and records a **byte-free pointer** on the ephemeral
`sharedKv` seam (`lib/attachments-meta.ts`): `{ id, filename, contentType, size, sha256, storageKey,
author, createdAt }`. The client is off-by-default — `attachmentsSidecar()` returns null when
`ATTACHMENTS_SIDECAR_URL` is unset and the routes answer `503 not configured`, mirroring
`retentionSourceFor`. The project-scoped room id (`issue:<projectId>:<issueId>`) is IDOR-guarded exactly
like comments.

## Later slices (deferred, additive)

- Cloud object-store backends in the sidecar (S3/GCS/Azure), layered behind the same `/blob` interface.
- SPA attach/list/remove UI.
- Helm PVC + NetworkPolicy + `values.yaml`.
- Content scanning, dedup/GC of orphaned blobs, per-capability gating (`cap: attachments`).
