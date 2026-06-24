# The Broker boundary

OmniProject talks to whatever fetches and writes the real project data through a
single **`Broker` interface**, expressed entirely in OmniProject's own domain
vocabulary. **n8n is the first — and currently only — implementation.** The point
of the seam is that the gateway is *structurally incapable* of knowing the broker
is n8n: if n8n is ever superseded, you implement one new class and nothing above
the seam changes.

```
 route handlers ─┐
 services        ├─▶  Broker (interface, domain types)  ◀─ N8nBroker  (the only live impl)
 exporter / BI  ─┘            src/broker/types.ts        ◀─ DemoBroker (canned data, no network)
```

- Interface + domain types: [`artifacts/api-server/src/broker/types.ts`](../artifacts/api-server/src/broker/types.ts)
- Selection + request→domain context: [`src/broker/index.ts`](../artifacts/api-server/src/broker/index.ts)
- n8n implementation (the **only** n8n-aware code): [`src/broker/n8n.ts`](../artifacts/api-server/src/broker/n8n.ts)
- Demo implementation: [`src/broker/demo.ts`](../artifacts/api-server/src/broker/demo.ts) (+ `demo-data.ts`)

## The contract

Everything above the seam calls `getBroker()` and the `Broker` interface — never
a concrete adapter. Core methods:

| Method | Purpose |
| ------ | ------- |
| `listProjects(ctx)` / `listIssues(ctx, projectId)` / `getIssue(ctx, projectId, issueId)` | normalised reads |
| `writeIssue(ctx, "create"\|"update"\|"delete", input)` | mutation; `input.expectedVersion` → optimistic concurrency (`conflict`) |
| `verify(ctx)` | dry-run probe; must never mutate a backend |
| `projectSummary` / `projectHistory` / `baseline` / `listRaid` / `addRaid` / `notifications` / `portfolioHealth` / `resourceCapacity` / `projectFinancials` / `capabilities` / `fxRates` | the read-model long tail (explicit methods — no action strings leak upward) |
| `command(ctx, name, payload)` | generic escape hatch (powers the command palette) |

Identity flows as an `ActorContext` (forwarded sub/email/role/token + transport
`authHeader`), built once from the request by `contextFromReq(req)`. Errors are a
normalised `BrokerError` with a `code` (`conflict | not_found | unauthorized |
bad_request | unavailable`) → HTTP status; `respondBrokerError(res, err)` maps it.

## Boundary invariants — things that may NEVER cross the seam

These are enforced by the architecture guard
([`src/__tests__/broker-guard.test.ts`](../artifacts/api-server/src/__tests__/broker-guard.test.ts)),
which **fails CI** on violation:

1. **The data-path modules contain zero n8n references** (prose included). The
   guard holds a `PRISTINE` list — `lib/data.ts`, `lib/capabilities.ts`,
   `lib/currency.ts`, `lib/programmes.ts`, `lib/metrics.ts`, and the
   `routes/{projects,portfolio,programmes,export,odata,integrations}.ts`
   handlers. Add a file here when it consumes broker data.
2. **The legacy n8n call API never appears outside `src/broker/`** —
   `callN8n`, `isN8nConfigured`, `N8nError`, `N8nResult`, `authHeaderFromReq`,
   `userContextFromReq`. If one resurfaces above the seam, a caller has bypassed
   the interface.
3. **Nothing above the seam imports the n8n adapter directly** (`../broker/n8n`)
   — except the one documented frozen-surface route below.

What this means concretely — these must **not** appear above the seam: the
webhook envelope (`{ action, payload, source, origin, idempotencyKey }`), the
`X-OmniProject-*` headers, n8n action strings (`list_projects`, `create_issue`,
…), n8n source labels (`capacity_engine`, …), `N8N_WEBHOOK_URL`, or the
`{ success, data, message }` response shape. All of that lives in `N8nBroker`.

### Public surface — now broker-named, with deprecated aliases (Stage B)

The public API/UI no longer leads with n8n. The canonical names are
broker-neutral; the old n8n names are kept as **deprecated aliases** so nothing
breaks:

| Canonical | Deprecated alias (still works) |
| --------- | ------------------------------ |
| `POST /api/broker/command` | `POST /api/n8n-proxy` |
| `BrokerCommandInput` / `BrokerCommandResult` schemas | (old `N8nActionInput` removed from the spec) |
| `Settings.brokerUrl` | `Settings.n8nWebhookUrl` (mirrored on read, accepted on write) |
| `BROKER_URL` env | `N8N_WEBHOOK_URL` env |

The remaining, *intentional* n8n names are the adapter's edge and are
guard-allowed:

- **`routes/broker-command.ts`** — serves both routes; the one place permitted to
  import `../broker/n8n` (it is the adapter's command edge);
- **`lib/settings.ts`** + config export/snapshot — carry the deprecated
  `n8nWebhookUrl`/`N8N_WEBHOOK_URL` aliases for back-compat;
- the **workflow generator** (`lib/n8n-backends.ts`, `n8n-generator.ts`,
  `n8n-expr.ts`) — emits n8n workflow JSON, n8n-specific by nature, alongside but
  logically under the seam.

The aliases can be removed in a future major version once consumers migrate.

## Demo mode is the DemoBroker

There is no longer a parallel "demo branch" interleaved into the callers. When no
backend is configured (`N8N_WEBHOOK_URL` unset), `getBroker()` returns the
`DemoBroker`, which serves canned sample data with no network and no n8n. It is
both the offline/CI harness and the proof the seam is clean: the whole gateway
runs against it (see the `DemoBroker` unit test and the guard).

## Adding a new broker

1. Create `src/broker/<name>.ts` exporting a class `implements Broker`. Put
   **all** of that backend's specifics inside it — transport, payload shapes,
   auth, error mapping to `BrokerError`.
2. Wire selection in `src/broker/index.ts` (e.g. a new env var picks it).
3. Nothing else changes. No route handler, service, exporter, or SPA code is
   touched, because they only know the `Broker` interface.
4. The guard keeps you honest: the new adapter's vocabulary must not leak above
   the seam.

## "n8n is superseded" — the swap story

If a better broker arrives (or n8n is retired), the entire migration is: write
`FooBroker implements Broker`, point the selector at it, and delete `n8n.ts` plus
its three documented exceptions. The data path, the API surface, the SPA, and
every test above the seam are untouched — because none of them ever knew the
broker was n8n. That is the property this boundary exists to guarantee.
