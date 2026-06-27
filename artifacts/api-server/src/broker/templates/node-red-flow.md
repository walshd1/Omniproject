# Node-RED broker flow — template

Node-RED runs **flows**, not Node you can `import`, so (like the Make / Power
Automate templates) it mirrors the **same binding structure** rather than reusing
`processBrokerCall`. The contract is the single source of truth:
`docs/BROKER-HTTP-BINDING.md`. Node-RED *is* a full data broker because an
**`HTTP In` → `HTTP Response`** pair returns a synchronous body — open-source and
self-hostable, so it's the easiest way to **truly test OmniProject against a real
external broker** (not just the in-memory sidecar).

## Quick start (the importable flow handles the handshake)

1. `npm i -g node-red && node-red` (or run the Docker image), open `http://localhost:1880`.
2. **Import** `node-red-flow.json` (Menu → Import), **Deploy**.
3. Point OmniProject at it: `BROKER_URL=http://localhost:1880/omniproject`.
4. Click **Verify** in the Setup wizard (or hit readiness) — it goes green: the flow
   answers the `verify` handshake and `get_capabilities` synchronously, with no
   backend. That alone proves the synchronous seam end to end.

## Flow shape

```
[HTTP In  POST /omniproject]  ← BROKER_URL points here
      │ body: { action, payload, source, origin, idempotencyKey, verify? }  (+ Authorization header)
      ▼
[function: binding]
  ├─ verify === true            → respond { success:true, data:{ verified:true } }   (no backend call)
  ├─ action = "get_capabilities" → respond { success:true, data:{ ...capability flags } }
  └─ data action                → set msg.url/method/headers → [HTTP Request → your backend]
                                                                     ▼
                                              [function: normalise → { success:true, data }]
      ▼
[HTTP Response]  status from the backend, body { success, data }
```

## Wiring the data actions

The starter flow answers `verify` + `get_capabilities` and returns `501` for data
actions. To make it a full broker, after the `binding` function add a **switch** on
`msg.payload.action` and, per action, an **HTTP Request** node to your backend, then
a function to map the result to `{ success: true, data }`:

| action | backend call |
| --- | --- |
| `list_projects` | `GET …/projects` |
| `list_issues` | `GET …/projects/{payload.projectId}/issues` |
| `create_issue` | `POST …/issues` |
| `update_issue` | `PATCH …/issues/{payload.issueId}` — return **409** + current row on a version mismatch |
| `delete_issue` | `DELETE …/issues/{payload.issueId}` |

## Rules to honour (same as every broker)

1. **Auth:** read the forwarded `Authorization` header (the user's token) and pass it
   to your HTTP Request nodes — the backend authorises. No shared admin key.
2. **verify:** `verify: true` ⇒ `{ success:true, data:{ verified:true } }`, no backend call.
3. **Errors:** set the HTTP Response status from the backend — `409` (with the
   current row) on an optimistic-concurrency conflict, `404`, `401/403`, else `4xx`
   = bad request, `5xx` = unavailable.
4. **Normalise** each backend result to the contract shape before responding.

Then run the OmniProject conformance suite against the flow URL — if it's green, the
seam is proven for Node-RED.

> PSK note: to use `BROKER_PSK`, add a decrypt step at the top of the `binding`
> function (AES-256-GCM, key = SHA-256(BROKER_PSK)) — or just use TLS (preferred).
