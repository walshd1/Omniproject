# Attachments — the below-the-seam file-bytes sidecar

OmniProject is a **stateless, zero-at-rest overlay**: a CI guard (`guard-zero-at-rest-above-seam`) forbids
the gateway from importing any database/object-store SDK or persisting data above the broker seam. File
attachments therefore can't live in the gateway. Instead the bytes live in a **separate, loosely-coupled
sidecar** — [`services/attachments-broker`](../services/attachments-broker/README.md) — and the gateway
keeps only a small **pointer** record (never bytes). This mirrors the [retention-broker](./RETENTION.md)
pattern exactly.

The stronger property the design guarantees: **a file's bytes NEVER pass through the gateway at all.** The
gateway only ever holds metadata and mints a short-lived link; the bytes travel **browser ↔ sidecar
directly**. So a (possibly malicious) upload is only ever inside the hardened, isolated sidecar container —
never in the gateway's process, memory, or storage.

> **Status:** the sidecar **service**, the **gateway ticket seam**, and the **SPA attach/list/download/remove
> UI** ship now. The compose/Helm wiring (now including the sidecar's browser-reachable ingress) and cloud
> object-store backends land as follow-on slices; the design is
> [`docs/design/STATEFUL-SIDECAR.md`](./design/STATEFUL-SIDECAR.md).

## Why a sidecar, and why bytes never touch the gateway

```
              (1) mint ticket          (3) record pointer
  browser ───────────────────────▶  gateway (zero-at-rest)
     │        {filename,size}      ◀───────────────────────   pointer record only:
     │        ◀── uploadUrl+ticket    (5) mint link            {id,name,type,size,sha256,key,by,at}
     │                                    │   HEAD /blob (verify) + DELETE /blob (cleanup) — metadata only
     │  (2) PUT bytes  │  (4/6) GET bytes │
     ▼                 ▼                  ▼
  attachments-broker (below the seam) ── /portal/<key>?ticket=…  (browser plane, CORS, ticket-authorised)
                                       ── /blob/<key>             (server plane, bearer, metadata only)
                                          └▶ filesystem store ─▶ /data   (bytes live ONLY here)
```

- **The gateway stays byte-free.** It stores only the pointer (id, filename, content-type, size, sha256,
  storage key, author, timestamp) as coordination state — structurally identical to how comments ride the
  ephemeral `sharedKv` seam — and imports no object-store SDK, so `guard-zero-at-rest-above-seam` stays
  green. It never reads or writes the bytes; it only **mints tickets** and, server-to-server, **HEAD-verifies
  and deletes** blobs.
- **The sidecar is hardened + isolated.** Its own process, its own image (digest-pinned, non-root,
  read-only root FS with only the `/data` volume writable), **zero runtime dependencies** (node built-ins
  only). It refuses to boot without `ATTACHMENTS_BROKER_TOKEN` (the server plane), and the browser upload
  portal is disabled (`503`) unless `ATTACHMENTS_TICKET_SECRET` is set.
- **Best practice: run the sidecar on a separate VM (or host) from the gateway and from backups.** Because
  a malicious upload only ever lands inside this one container, isolating it at the machine boundary — not
  just the process boundary — contains blast radius: a compromise of the byte store can't reach the gateway,
  the databases behind the broker, or backup storage. The two-URL split below (internal server-plane URL vs.
  browser-reachable public URL) is exactly what lets the sidecar live on its own VM behind its own ingress.

## Tickets — the capability that replaces proxying

The gateway holds a shared HMAC secret (`ATTACHMENTS_TICKET_SECRET`) and mints a **ticket** — a signed,
op-and-key-scoped, quickly-expiring capability — that the browser presents to the sidecar's portal:

```
ticket = base64url(payloadJSON) "." base64url(HMAC-SHA256(payloadJSON, secret))
payload = { op: "put" | "get", key, room, exp }     // exp = epoch ms; "get" may carry a filename
```

The sidecar verifies the signature, the op, the key, and the expiry before serving a single direct byte
transfer. A leaked ticket can't be replayed against another blob or after its short window, and the browser
never needs the admin bearer token.

## The sidecar contract

**Browser plane** — the browser reaches these directly via a gateway-minted ticket URL (CORS-enabled):

| Method | Path | Auth | Result |
| --- | --- | --- | --- |
| `OPTIONS` | `/portal/<key>` | none (preflight) | `204` + CORS |
| `PUT` | `/portal/<key>?ticket=…` | put-ticket | `{ ok, key, size, sha256 }` |
| `GET` | `/portal/<key>?ticket=…` | get-ticket | `application/octet-stream` (`content-disposition` from the ticket's filename) |

**Server plane** — the gateway reaches these server-to-server (bearer), metadata only, no bytes:

| Method | Path | Auth | Result |
| --- | --- | --- | --- |
| `GET` | `/healthz` | none | `{ ok: true }` |
| `HEAD` | `/blob/<key>` | bearer | `200` + `X-Attachment-Size` / `404` |
| `DELETE` | `/blob/<key>` | bearer | `{ ok }` / `404` |

Keys are flat, path-traversal-safe tokens (`[A-Za-z0-9._-]{1,200}`). Uploads past `ATTACHMENTS_MAX_BYTES`
(default 25 MB) are rejected `413`. Full config + run instructions:
[`services/attachments-broker/README.md`](../services/attachments-broker/README.md).

## Wiring sketch (compose)

Like the retention-broker, the sidecar ships as `services/` code with a copy-in compose sketch rather than
being force-added to a production compose file until the ingress wiring lands. Note the sidecar now needs a
**browser-reachable** ingress (its own hostname / TLS) so the portal URLs the gateway mints resolve from the
user's browser — ideally on a separate VM per the note above:

```yaml
  attachments-broker:
    build: { context: ., dockerfile: services/attachments-broker/Dockerfile }
    image: omniproject-attachments-broker:0.1.0
    environment:
      ATTACHMENTS_BROKER_TOKEN: ${ATTACHMENTS_BROKER_TOKEN:?set a token}   # server plane (gateway↔sidecar)
      ATTACHMENTS_TICKET_SECRET: ${ATTACHMENTS_TICKET_SECRET:?set a secret} # browser upload/download portal
      ATTACHMENTS_ALLOWED_ORIGIN: ${PUBLIC_URL:-*}                         # CORS: the SPA's origin
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

The gateway is wired with:

- `ATTACHMENTS_SIDECAR_URL=http://attachments-broker:8091` — the **internal** server-plane base (HEAD/DELETE),
  reached through the SSRF/egress guard like every other outbound hop;
- `ATTACHMENTS_SIDECAR_TOKEN=<same as ATTACHMENTS_BROKER_TOKEN>` — the server-plane bearer;
- `ATTACHMENTS_SIDECAR_PUBLIC_URL=https://attachments.example.com` — the **browser-reachable** portal base
  the minted ticket URLs point at;
- `ATTACHMENTS_TICKET_SECRET=<same as the sidecar's>` — the shared HMAC secret for minting tickets.

Without the last two, uploads/downloads report `503 not configured` while listing/delete keep working.

Because the browser now talks to the sidecar's public origin directly, two cross-origin knobs must line up:
the sidecar's `ATTACHMENTS_ALLOWED_ORIGIN` must be the SPA's origin (CORS), and the SPA's Content-Security-
Policy `connect-src` must include the sidecar's public origin (`CSP_CONNECT_SRC`) so the direct PUT/GET
isn't blocked.

## Gateway seam (shipped)

The `attachments` feature module (default-off; enable with `ENABLED_FEATURES=attachments`) exposes:

| Method | Route | Who | What |
| --- | --- | --- | --- |
| `GET` | `/api/attachments/:roomId` | any authed user (project-scoped) | list the room's pointers |
| `POST` | `/api/attachments/:roomId/upload-ticket` | contributor+ | mint a one-shot direct-to-sidecar upload URL |
| `POST` | `/api/attachments/:roomId` | contributor+ | record the pointer after a direct upload |
| `GET` | `/api/attachments/:roomId/:id/link` | any authed user (project-scoped) | mint a one-shot direct download URL |
| `DELETE` | `/api/attachments/:roomId/:id` | the uploader, or pmo/admin | drop pointer + bytes |

The upload dance (bytes never touch the gateway):

1. **mint** — the browser POSTs `{ filename, size }` to `…/upload-ticket`; the gateway mints a fresh storage
   key + a signed put-ticket and returns a direct-to-sidecar `uploadUrl` (no bytes cross the gateway);
2. **PUT** — the browser PUTs the file **straight to the sidecar portal** (cross-origin, ticket-authorised,
   no cookies/CSRF), which stores it and returns the size + sha256 it computed;
3. **record** — the browser POSTs `{ storageKey, filename, contentType, sha256 }` to `…/:roomId`; the gateway
   **HEAD-verifies** the blob actually landed (server plane), takes the sidecar's size as authoritative (never
   the client's claim), and records a **byte-free pointer** on the ephemeral `sharedKv` seam
   (`lib/attachments-meta.ts`): `{ id, filename, contentType, size, sha256, storageKey, author, createdAt }`.

Download mints a get-ticket link (`…/:id/link`) and the browser fetches the bytes directly from the sidecar.
The client is off-by-default — `attachmentsSidecar()` returns null when `ATTACHMENTS_SIDECAR_URL` is unset and
the routes answer `503 not configured`, mirroring `retentionSourceFor`. The project-scoped room id
(`issue:<projectId>:<issueId>`) is IDOR-guarded exactly like comments.

## Later slices (deferred, additive)

- Cloud object-store backends in the sidecar (S3/GCS/Azure), layered behind the same store interface. The
  object-store **SDKs live in and connect out from the sidecar** — never the gateway; the invariant is that
  any untrusted bytes route through this service and only this service.
- Helm PVC + a **browser-reachable Ingress** + NetworkPolicy + `values.yaml`; adding the sidecar (ideally on
  its own node/VM) to a production compose profile.
- Content scanning, dedup/GC of orphaned blobs, per-capability gating (`cap: attachments`).
