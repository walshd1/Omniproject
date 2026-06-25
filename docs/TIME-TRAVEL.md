# Time-travel — historical portfolio replay

OmniProject can scrub a portfolio **back and forward in time** — replaying the
state it was in at any recorded point. The catch: OmniProject is **stateless and
stores nothing**, so there is no history to replay until you give it somewhere to
keep one. That somewhere is a **logging server you own**, and turning it on is an
explicit, out-of-warranty opt-in.

This page covers the architecture, the opt-in gate, the SSRF-validated sink URL,
the capability flag, the provenance lanes, and how to import and wire the
blueprint that makes it work.

## Architecture — stateless lens over an operator-owned log

```
                 opt-in egress (Historian, scheduled)
 OmniProject  ──────────────────────────────────────▶  Operator's logging server
 (stateless)                                            (Elasticsearch / Loki /
      ▲                                                  OpenSearch / HTTP store)
      │ GET /api/history/replay                                 │
      │   → Broker.replay({ from?, to? })                       │
      └──────────  brokered `replay` action  ◀──────────────────┘
                   returns HistoryState[]
```

OmniProject never holds the history. Two flows make time-travel work, and they
live entirely outside the gateway's own storage:

1. **Write (egress):** a scheduled job in your broker captures the current
   portfolio state and writes a timestamped record to your logging server. This
   is the **Historian** branch of the blueprint.
2. **Read-back (replay):** `GET /api/history/replay` brokers the **`replay`**
   action, which queries that logging server for records in a time window and
   returns them as `HistoryState[]`. This is the **Replay** branch.

The gateway stays a thin lens. See [BROKER.md](BROKER.md) for the seam this rides
on — `replay(ctx, { from?, to? })` is a first-class `Broker` method, so nothing
above the seam knows the history came from n8n or a logging server.

## The opt-in gate — admin-only + warranty acknowledgement

State-history egress is **OFF by default**. It is the single deliberate
relaxation of OmniProject's "nothing leaves" posture, and it sits in the **same
trust class as the OData / Prometheus / Power BI feeds**: data egresses, by
explicit admin choice, to a destination the operator controls and is responsible
for.

Enabling it is gated three ways — all enforced server-side in
`updateSettings` ([`lib/settings.ts`](../artifacts/api-server/src/lib/settings.ts)):

- **Admin-only.** The control (Setup → *Logging server (history & time-travel)*)
  and the `loggingSync` settings write are admin-scoped.
- **A destination URL is required.** You cannot enable egress without a
  `loggingSync.url`.
- **Warranty acknowledgement is required.** The admin must tick
  `acknowledgedWarranty`; the server rejects `enabled: true` without it with a
  400:

  > enabling the logging sync requires acknowledging that egressed data is
  > outside OmniProject's warranty

Configured via env, the equivalent is `LOGGING_SYNC_URL` plus
`LOGGING_SYNC_ACK_WARRANTY=true` — egress only switches on when both are present
**and** the URL passes the safety check below.

## The SSRF-validated sink URL

The sink URL is an outbound target, so it goes through the same outbound-URL
safety check as every other operator-set URL (broker, webhooks, OIDC issuer):
`assertSafeOutboundUrl`
([`lib/url-safety.ts`](../artifacts/api-server/src/lib/url-safety.ts)).

- It must be a **well-formed `http(s)` URL**.
- The **cloud-metadata / link-local range is rejected** — IPv4 `169.254.0.0/16`
  (including the `169.254.169.254` IMDS endpoint) and IPv6 `fe80::/10`. This
  blunts the worst SSRF vector (metadata-credential theft) without blocking the
  legitimately-internal hosts (`http://logs:9200`, loopback dev endpoints) that
  self-hosted installs rely on.

An unsafe URL is dropped at load (env path) and rejected with a 400 on an admin
write, so a bad value can never be persisted.

## The capability flag

`capabilities.timeTravel` is **true only when egress is enabled**
([`lib/capabilities.ts`](../artifacts/api-server/src/lib/capabilities.ts) →
`isTimeTravelEnabled()`). The UI reads `GET /api/capabilities` and only surfaces
the time-travel scrubber when the flag is set.

The endpoint mirrors this gate: **`GET /api/history/replay` returns `409`** unless
time-travel is enabled —

> Time-travel is not enabled. Enable the logging server in settings to retain and
> replay history.

— because without a logging server there is no recorded history to replay
([`routes/history.ts`](../artifacts/api-server/src/routes/history.ts)).

`timeTravel` is distinct from the `history` capability **domain** (in
`CAPABILITY_DOMAINS`): `history` means a backend can serve a per-project
changelog; `timeTravel` means the operator opted into the durable portfolio-level
log that powers replay.

## Provenance lanes — what a state actually is

Every `HistoryState` carries a `provenance` so the UI never presents a model as
recorded fact ([`broker/types.ts`](../artifacts/api-server/src/broker/types.ts)):

| Provenance  | Meaning |
| ----------- | ------- |
| `replayed`  | A **real recorded state**, read back from the operator's logging server. The Historian writes these and the Replay branch returns these. |
| `projected` | A **model of the future** — never fact. |
| `sourced` / `derived` | A state read or computed directly from a backend, not from the recorded log. |
| `sample`    | **Demo data.** Demo mode synthesises a short ramp toward current completion, badged `sample`, so the scrubber has something to move even with no logging server. |

The replay path defaults recorded states to `replayed` if the workflow omits the
field, so a logging store that just hands back the raw records is still correct.

## The `HistoryState` contract

The Replay branch must return an array of:

```jsonc
{
  "at": "2026-06-25T14:00:00.000Z",  // ISO 8601 timestamp of the recorded state
  "completionPct": 62,                // portfolio-level percent complete
  "openBlockers": 4,                  // count, or null if unknown
  "provenance": "replayed"            // recorded fact
}
```

`GET /api/history/replay?from=<ISO>&to=<ISO>` brokers the **`replay`** action with
payload `{ from?, to? }` (both optional) and expects this array back. See
[N8N-WORKFLOWS.md](N8N-WORKFLOWS.md) for the action-envelope and
`N8nActionResult` conventions the broker uses underneath.

## The blueprint — import & wire

The reference implementation is
[`artifacts/n8n-blueprints/omniproject-time-travel.json`](../artifacts/n8n-blueprints/omniproject-time-travel.json).
It carries **both** flows in one workflow:

```
HISTORIAN (egress / write):
  Schedule (hourly) → Read current portfolio state → Build history record
    → Write to logging store (operator-owned, LOGGING_SYNC_URL)

REPLAY (read-back):
  Webhook → Action == replay? → Query logging store → Map → HistoryState[]
    → Respond N8nActionResult            (else → Unsupported Action)
```

The HTTP nodes are written for portability — swap **Write to logging store** /
**Query logging store** for a native Elasticsearch / Loki / OpenSearch node if you
have one; the record shape stays the same.

### Import

1. In n8n: **Workflows → Import from File** → select
   `omniproject-time-travel.json`.
2. Set the n8n environment variables:

   | Env var | Purpose |
   | ------- | ------- |
   | `LOGGING_SYNC_URL` | Base URL of your logging store (e.g. `https://logs.internal:9200/omni-history`). Must match the SSRF-validated `loggingSync.url` you set in OmniProject. |
   | `OMNI_API_BASE` | OmniProject gateway base URL the Historian reads the live portfolio from. |
   | `OMNI_HISTORY_TOKEN` | Bearer token for the Historian's reads and the sink writes (optional, depending on your store/gateway auth). |
   | `LOGGING_SYNC_QUERY_URL` | Read endpoint for replay, if different from `LOGGING_SYNC_URL`. |

3. Tune the **Schedule** node (hourly by default; daily for a coarser, smaller
   history) and adjust the **Query logging store** params to your store's API
   (an Elasticsearch range query, a Loki LogQL range, …).
4. Activate the workflow. Point the OmniProject broker at the **Webhook**
   production URL via `BROKER_URL` — or merge the Replay branch into your
   existing core-sync workflow's action switch (it only handles
   `action == "replay"`, falling through otherwise, so it composes cleanly).
5. In OmniProject: **Setup → Logging server (history & time-travel)** → enter the
   same URL, tick the warranty acknowledgement, and **Enable egress & unlock
   time-travel**.

Once enabled, `capabilities.timeTravel` flips to `true`, the scrubber appears, and
`GET /api/history/replay` stops returning `409`.

## The out-of-warranty boundary — operator responsibility

This is the explicit boundary, stated plainly:

> **Data egressed to the logging server leaves OmniProject's control and
> warranty.** Your organisation is responsible for its security, retention,
> residency, and lawful processing.

OmniProject mints and ships the records; it does not store, manage, secure, or
stand behind them once they reach your sink. This is the same posture as the
OData / Power BI / Prometheus feeds: the gateway hands data to a destination *you*
chose and *you* own. The blueprint's sticky notes and the **Write to logging
store** node both flag this at the egress point so it is visible where the data
actually leaves.

If you need OmniProject to remain truly stateless with **nothing leaving**, leave
the logging server off — time-travel simply stays locked.

---

See also: [BROKER.md](BROKER.md) · [N8N-WORKFLOWS.md](N8N-WORKFLOWS.md) ·
[the blueprints](../artifacts/n8n-blueprints/).
