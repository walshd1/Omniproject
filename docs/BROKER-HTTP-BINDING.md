# Broker HTTP binding (v1)

This is the **reference HTTP binding** of the broker contract — the exact wire
protocol a *contract-speaking HTTP broker* implements. It is what n8n implements
today, and what an external **sidecar broker** (e.g. a Postgres-backed
"OmniProject as system of record" service, see
[RFC-003](design/RFC-003-db-broker.md)) implements to plug in with **zero changes
to the core**: you point `BROKER_URL` at it instead of n8n.

It is language-agnostic. If your service accepts these POSTs and returns these
envelopes, OmniProject can broker through it. The data shapes are defined by the
machine-readable [contract schema](contract/broker.v1.schema.json) and
[CONTRACT.md](CONTRACT.md); this document defines the **transport** that carries
them.

> Contract version: **v1**. Additive payload fields are non-breaking. The
> conformance suite (`broker/conformance.ts`) is the acceptance test — a broker
> that passes it is conformant.

> **Start here: the reference sidecar.** `artifacts/api-server/src/broker/reference-sidecar.ts`
> is a minimal, in-memory implementation of this whole binding — both a working
> **author template** (run it: `pnpm --filter @workspace/api-server run sidecar`,
> then point `BROKER_URL` at it) and the **CI fixture** that proves the seam:
> `http-conformance.test.ts` runs the reference broker over real HTTP against it
> and asserts the conformance suite passes. A DB-backed sidecar (RFC-003) swaps
> the in-memory store for Postgres/Mongo/etc.; when it passes the same
> conformance test, it drops in with **zero changes to the core**.

---

## 1. Request

The gateway sends every action as a single `POST` to the broker URL
(`BROKER_URL`, or a pool via `BROKER_URLS`). One endpoint handles all actions;
the action name is both a header and a body field.

**Headers**

| Header | Meaning |
| --- | --- |
| `Content-Type: application/json` | Always. |
| `Authorization` | The end user's forwarded credential (e.g. `Bearer <OIDC access token>`), present when the action acts "as" the user. Use it to authorise against your store; never a shared admin key. |
| `X-OmniProject-Action` | The action being invoked (see §3). |
| `X-OmniProject-Source` | Backend routing hint (e.g. `financial_ledger`, `raid_register`). |
| `X-OmniProject-Origin` | Always `omniproject` — the loop-guard. Echo it on any event you emit so the gateway can drop its own echoes. |
| `X-OmniProject-Idempotency-Key` | Deterministic `sha256(action:projectId:issueId:minute)`. You MAY use it to collapse duplicate triggers. |

**Body**

```jsonc
{
  "action": "create_issue",
  "payload": {
    // the action's arguments (see §3) …
    "projectId": "proj-001",
    "title": "New task",
    // loop-guard, mirrored from the header
    "origin": "omniproject",
    // present only for "as the user" actions (withActor):
    "userContext": { "sub": "u1", "email": "a@b.c", "name": "Ada", "role": "manager", "token": "<access token>" }
  },
  "source": "all",
  "origin": "omniproject",
  "idempotencyKey": "…"
}
```

---

## 2. Response

Return the **envelope**:

```jsonc
{ "success": true, "data": <the normalised result>, "message": null }
```

- `data` is the normalised shape for that action (see the schema). For list
  actions it is an array; for `delete_issue` it may be `null`.
- A **bare body** (no `success` key) is accepted and treated as
  `{ success: true, data: <body> }` — convenient, but the envelope is preferred.
- **Errors are HTTP status codes**, mapped by the gateway onto the normalised
  error taxonomy (do NOT leak backend-internal messages; the gateway derives a
  safe client message from the code):

  | HTTP status | Normalised code |
  | --- | --- |
  | `409` | `conflict` (optimistic-concurrency) |
  | `404` | `not_found` |
  | `401` / `403` | `unauthorized` |
  | other `4xx` | `bad_request` |
  | `5xx` / unreachable | `unavailable` |

- **Optimistic concurrency:** when an update's `expectedVersion` doesn't match
  your stored `version`, return **409** with the *current* row as the body — the
  gateway carries it out-of-band as the conflict `details` so the UI can refresh.

- **Provenance:** for derived/historical responses set `provenance` on the rows
  (`sourced` for real records, `derived`/`sample`/`replayed`/`projected` as
  applicable). A store-of-record broker uses `sourced`.

---

## 2a. Optional PSK transport encryption (`BROKER_PSK`)

A **fallback below TLS** for hops where TLS is genuinely unavailable. TLS
(`https://` broker URL, optionally mTLS) is always preferred — it also
authenticates the broker's certificate, which PSK does not. See
docs/ops/EGRESS-INVENTORY.md §3b for the full hierarchy and caveats (no forward
secrecy, no peer auth, metadata still visible).

When the gateway has `BROKER_PSK` set, every request body becomes an **encrypted
envelope** instead of the plaintext one, and the routing headers + `Authorization`
are dropped (so nothing sensitive is on the wire in cleartext):

```jsonc
// Headers: Content-Type: application/json,  X-OmniProject-Enc: p1
{ "v": 1, "enc": "p1.<base64url(iv|tag|ciphertext)>" }
```

- `enc` decrypts (AES-256-GCM, key = `SHA-256(BROKER_PSK)`, 96-bit random IV,
  16-byte tag, all base64url after the `p1.` version prefix) to the **normal
  plaintext envelope** — `{ action, payload, source, origin, idempotencyKey, auth }`
  — where `auth` is the forwarded `Authorization` value (the token is *inside* the
  ciphertext, not in a header).
- **Reply the same way:** encrypt your `{ success, data, message }` response with
  the same scheme and return `{ "v": 1, "enc": "p1.…" }`. A bad/missing key MUST
  fail the GCM auth tag → return **400** (never a silent plaintext passthrough).
- The reference sidecar implements both ends (`broker/reference-sidecar.ts`,
  helpers in `lib/broker-psk.ts`), proven by `broker/psk-wire.test.ts`.

---

## 3. Action catalogue

Every action, the broker method it backs, whether the user context is forwarded
(`actor`), and the conventional `source` hint. Request payload = the listed
fields (+ `origin`/`userContext`); response = the named schema type.

| Action | Method | actor | source hint | Payload → Response |
| --- | --- | :---: | --- | --- |
| `list_projects` | listProjects | no | (backend) | `{}` → `Project[]` |
| `list_issues` | listIssues | no | (backend) | `{projectId}` → `Issue[]` |
| `get_issue` | getIssue | no | (backend) | `{projectId, issueId}` → `Issue \| null` |
| `create_project` | createProject | yes | (backend) | `ProjectWrite` → `Project` |
| `update_project` | updateProject | yes | (backend) | `{projectId, …ProjectWrite}` → `Project` |
| `create_issue` | writeIssue("create") | yes | (backend) | `IssueWrite` → `Issue` |
| `update_issue` | writeIssue("update") | yes | (backend) | `IssueWrite` (+ `expectedVersion`) → `Issue` |
| `delete_issue` | writeIssue("delete") | yes | (backend) | `{projectId, issueId}` → `null` |
| `list_project_members` | projectMembers | no | (backend) | `{projectId}` → `ProjectMember[]` |
| `list_task_items` | listTaskItems | no | (backend) | `{projectId, taskId}` → `TaskItem[]` |
| `create_task_item` | createTaskItem | yes | (backend) | `{projectId, taskId, …TaskItemWrite}` → `TaskItem` |
| `list_activity` | listActivity | no | (backend) | `{}` → `Row[]` |
| `project_summary` | projectSummary | no | (backend) | `{projectId}` → `Summary` |
| `get_project_history` | projectHistory | no | `history_provider` | `{projectId}` → `HistoryPoint[]` |
| `get_baseline` | baseline | no | `baseline_store` | `{projectId}` → `Baseline \| null` |
| `get_raid` | listRaid | no | `raid_register` | `{projectId}` → `Row[]` |
| `create_raid_entry` | addRaid | yes | `raid_register` | `{projectId, …}` → `Row` |
| `get_notifications` | notifications | no | `notification_center` | `{}` → `Row[]` |
| `get_portfolio_health` | portfolioHealth | yes | `portfolio_master` | `{}` → `PortfolioRow[]` |
| `get_resource_capacity` | resourceCapacity | yes | `capacity_engine` | `{projectId}` → `Row[]` |
| `get_project_financials` | projectFinancials | yes | `financial_ledger` | `{projectId}` → financials `Row` |
| `get_capabilities` | capabilities | yes | `capability_probe` | `{}` → `CapabilityFlags` |
| `get_fx_rates` | fxRates | no | `fx_provider` | `{}` → `FxRates` |
| `replay` | replay | no | `history_provider` | `{from?, to?}` → `HistoryState[]` |

**`verify` (dry-run):** the gateway's verification probe calls only the
**read-only** actions above (`get_capabilities`, `list_projects`, `list_issues`,
`list_activity`, `get_resource_capacity`, `get_project_financials`,
`get_portfolio_health`, `get_project_history`, `get_baseline`, `get_raid`,
`get_notifications`). A broker MUST treat these as side-effect-free.

**Capabilities drive everything else.** `get_capabilities` returns the domain
flags (`issues, scheduling, resources, financials, portfolio, baseline, blockers,
history, raid`) the store supports; the gateway derives the per-field/entity
surface/store map from them. A store-of-record broker (which owns its schema) can
return all domains `true` and surface the full field registry. (The optional
`fieldMap`/`describeFields` contract methods are not part of this HTTP binding —
the gateway derives the map from capabilities; a richer broker may serve them via
a future action.)

---

## 4. Events (optional, both directions)

- **Inbound ingest:** to push a notification into OmniProject, `POST` to the
  gateway's `/api/notifications/ingest` with body
  `{ target?, notification: { title, … } }`, authenticated by the
  `NOTIFY_INGEST_SECRET` shared secret (`Authorization: Bearer <secret>` or
  `X-Notify-Secret`). See `NotificationIngest` in the schema.
- **Outbound events:** the gateway can push HMAC-signed events *to* you (or any
  endpoint) — body `{ event, deliveredAt, deliveryId, data }`, signature
  `X-OmniProject-Signature: sha256=<hex HMAC-SHA256(body, secret)>`. Verify by
  recomputing over the exact body.

---

## 5. Building a sidecar broker (the short version)

1. Stand up an HTTP service with one `POST` endpoint.
2. Switch on `payload.action`; implement each action against your store
   (Postgres, etc.), authorising with the forwarded `Authorization` / `userContext`.
3. Return `{ success, data }`; use HTTP status codes for errors; return `409`
   with the current row on a version conflict.
4. Maintain `version` per issue and the denormalised roll-up counts
   (`issueCount`, `completedCount`, and any financial fields) on write.
5. Run the conformance suite against it (reference pass = parity with
   `DemoBroker`).
6. Deploy it; set `BROKER_URL` on the gateway to its address. Done — no core
   change.

This is the whole integration surface. Anything OmniProject can do, it does
through these actions; if your service answers them, it is a first-class broker.

## 6. Alternative brokers (Make / Zapier / IFTTT)

n8n is the *reference* broker, not the only one — any automation platform that can
answer this binding can take its place. The hard requirement is a **synchronous**
webhook: the gateway POSTs `{ action, payload }` and **waits for `{ success, data }`
in the same HTTP response**. That cleanly splits the iPaaS options:

| Platform | As a data broker? | Why |
| --- | --- | --- |
| **Make** (Integromat) | **Yes** | Its *Custom webhook* + *Webhook response* modules return a synchronous body, so a Make scenario can dispatch to the backend and reply with `{ success, data }`. Build one scenario that switches on `action`, point `BROKER_URL` at the webhook, and run the conformance suite — same path as n8n. |
| **Zapier** | **Inbound/events only** | Zaps run asynchronously and can't return a custom synchronous HTTP body to the caller, so Zapier can't serve read-through reads. It *is* useful on the edges: trigger Zaps **from** OmniProject's outbound HMAC events (§4), or have a Zap **push** updates into `POST /api/notifications/ingest`. |
| **IFTTT** | **Inbound/events only** | Webhooks (Maker) are fire-and-forget triggers with no synchronous response and minimal logic — same role as Zapier: event in/out, not the data broker. |

So: **Make** is a drop-in alternative to n8n for the full read/write contract;
**Zapier/IFTTT** widen the *event* surface (notifications in, automations out) but
sit alongside a real broker rather than replacing it. For the data hop, the
HTTP-binding sidecar (§5) or n8n/Make remain the supported paths.
