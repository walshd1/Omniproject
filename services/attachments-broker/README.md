# attachments-broker

The **below-the-seam** service that gives OmniProject file attachments a real home. It holds the file
**bytes** that the gateway is forbidden to store (the `guard-zero-at-rest-above-seam` guard enforces
that the gateway imports no object-store SDK and persists nothing above the broker seam), and exposes
them over a tiny HTTP contract. This is a **separate process** on purpose: the gateway keeps only a
small *pointer* record (id, filename, content-type, size, sha256, key, author, timestamp — never
bytes); the bytes live here.

Crucially, the file bytes **never pass through the gateway at all** — the browser transfers them
**directly** to/from this service using a short-lived, gateway-minted **ticket**. So a (possibly
malicious) upload only ever exists inside this one hardened container. Best practice is to run it on a
**separate VM/host** from the gateway and from backups, so the machine boundary — not just the process
boundary — contains the blast radius.

It is **not** part of the pnpm workspace and has **zero runtime dependencies** — node built-ins only
(`node:http`, `node:crypto`, `node:fs`) — so there is no third-party supply-chain surface to audit and
nothing to `npm install`.

## How it fits — two planes

```
                    (1) mint ticket
  browser ─────────────────────────────▶  gateway (zero-at-rest, pointer only)
     │  (2) PUT/GET bytes with ticket        │  HEAD/DELETE /blob (metadata only, bearer)
     ▼                                        ▼
  /portal/<key>?ticket=…  (browser plane)   /blob/<key>  (server plane)
        └──────────────────┬───────────────────┘
                           ▼
                  filesystem store ─▶ /data   (bytes live only here)
```

- **Browser plane (`/portal/<key>`)** — the browser uploads/downloads bytes here **directly**, authorised
  by a short-lived HMAC **ticket** the gateway minted (scoped to one op + one key, quickly-expiring).
  CORS-enabled so the SPA can reach it cross-origin. Disabled (`503`) unless `ATTACHMENTS_TICKET_SECRET`
  is set.
- **Server plane (`/blob/<key>`)** — bearer-token, server-to-server, for the gateway's **metadata-only**
  ops (`HEAD` to verify an upload's size, `DELETE` to drop bytes). No bytes ever flow to the gateway.

A ticket is `base64url(payloadJSON).base64url(HMAC-SHA256(payloadJSON, secret))` with
`payload = { op: "put"|"get", key, room, exp }` (`exp` = epoch ms; a `get` ticket may carry a `name` so a
direct download is named). The service verifies the signature, op, key, and expiry before serving a single
transfer.

A later, additive backend can swap the filesystem store for a cloud object store (S3/GCS/Azure) behind the
same store interface, exactly as the retention-broker layers its SDK ports. Those **cloud-service SDKs live
here in the sidecar and connect out from here** — the byte-holding SDK never crosses the seam into the
gateway. The invariant is one-directional: **any untrusted bytes must route through this service**, and only
this service; the gateway handles metadata and links, nothing else.

## Contract

**Browser plane** (ticket-authorised, CORS):

| Method | Path | Auth | Result |
| --- | --- | --- | --- |
| `OPTIONS` | `/portal/<key>` | none (preflight) | `204` + CORS |
| `PUT` | `/portal/<key>?ticket=…` | put-ticket | store bytes → `{ ok, key, size, sha256 }` |
| `GET` | `/portal/<key>?ticket=…` | get-ticket | `application/octet-stream` (`content-disposition` from the ticket) |

**Server plane** (bearer, metadata only) + liveness:

| Method | Path | Auth | Result |
| --- | --- | --- | --- |
| `GET` | `/healthz` | none | `{ ok: true }` (liveness) |
| `HEAD` | `/blob/<key>` | bearer | `200` + `X-Attachment-Size` / `404` |
| `DELETE` | `/blob/<key>` | bearer | `{ ok }` / `404` |

A `<key>` is a flat, path-traversal-safe token (`[A-Za-z0-9._-]{1,200}`, no `/`, no `..`). Uploads past
`ATTACHMENTS_MAX_BYTES` (default 25 MB) are rejected `413`.

## Malware / AV scanning

Every upload is scanned **before it is stored** (`src/scan.mjs`); a file that fails is rejected `422` and
never written — so a malicious upload is caught here, in the one container it ever touches, and never becomes
downloadable. Two layers:

- **Always-on heuristics** (zero-dependency): the **EICAR** test signature and raw executable / script magic
  bytes (PE `MZ`, ELF, Mach-O, Java class, `#!` shebang). Content-based — a renamed executable is still caught.
  Executables are refused by default (`ATTACHMENTS_SCAN_ALLOW_EXECUTABLES=1` to allow).
- **Optional ClamAV**: set `ATTACHMENTS_CLAMAV_ADDRESS=host:3310` and the bytes are streamed to a `clamd`
  (INSTREAM, over `node:net`, no npm dependency) for full signature detection. **Fail-closed** by default (a
  scanner outage rejects the upload); `ATTACHMENTS_SCAN_FAIL_OPEN=1` allows through in a degraded mode. A real
  detection is always fatal.

Run `clamd` as its own service (same separate-VM logic as the sidecar), never in the gateway.

## Run

```bash
cd services/attachments-broker
ATTACHMENTS_BROKER_TOKEN=$(openssl rand -hex 24) \
ATTACHMENTS_TICKET_SECRET=$(openssl rand -hex 24) \
ATTACHMENTS_ALLOWED_ORIGIN=https://app.example.com \
ATTACHMENTS_BROKER_DIR=./data npm start
```

Then point the gateway at it (a later slice wires this):
`ATTACHMENTS_SIDECAR_URL=http://attachments-broker:8091` (internal server plane),
`ATTACHMENTS_SIDECAR_TOKEN=<same as ATTACHMENTS_BROKER_TOKEN>`,
`ATTACHMENTS_SIDECAR_PUBLIC_URL=https://attachments.example.com` (browser-reachable portal), and
`ATTACHMENTS_TICKET_SECRET=<same secret as here>`.

## Config

| Env | Default | Notes |
| --- | --- | --- |
| `ATTACHMENTS_BROKER_TOKEN` | — | **Required** (server plane). Bearer token gating `/blob/*`. The service refuses to boot without it. |
| `ATTACHMENTS_TICKET_SECRET` | — | Shared HMAC secret for the browser upload/download **portal**. Unset ⇒ the portal is disabled (`503`). Must match the gateway. |
| `ATTACHMENTS_ALLOWED_ORIGIN` | `*` | CORS origin for the browser plane — set to the SPA's origin in production. |
| `ATTACHMENTS_BROKER_ALLOW_ANON` | — | Set `1` to accept **unauthenticated** server-plane requests (loopback-only dev; never production — logs a warning). |
| `ATTACHMENTS_BROKER_DIR` | `/data` | The writable volume the bytes live in. Mount it; the container root FS can stay read-only. |
| `ATTACHMENTS_MAX_BYTES` | `26214400` | Max upload size (bytes). |
| `ATTACHMENTS_CLAMAV_ADDRESS` | — | `host:port` of a ClamAV `clamd` for signature-based AV. Unset ⇒ heuristics only. |
| `ATTACHMENTS_CLAMAV_TIMEOUT_MS` | `30000` | Per-scan ClamAV timeout. |
| `ATTACHMENTS_SCAN_FAIL_OPEN` | — | Set `1` to allow an upload through (degraded) when ClamAV is unreachable/errors. Default fails closed. |
| `ATTACHMENTS_SCAN_ALLOW_EXECUTABLES` | — | Set `1` to permit executable/script uploads (default refuses them by magic bytes). |
| `HOST` | `0.0.0.0` | Set `127.0.0.1` to bind loopback only. |
| `PORT` | `8091` | Listen port. |

## Test

```bash
npm test        # node:test, fully offline — a real server on an ephemeral port, temp-dir store
```
