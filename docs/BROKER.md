# The Broker boundary

OmniProject talks to whatever fetches and writes the real project data through a
single **`Broker` interface**, expressed entirely in OmniProject's own domain
vocabulary and **published as a versioned contract** ([CONTRACT.md](CONTRACT.md)).
OmniProject is **broker-agnostic by design, with n8n as the reference broker** —
the production implementation that ships — while `DemoBroker` is a second,
in-process implementation that proves the seam is generic by serving the whole
app from sample data with no backend. The point of the seam is that the gateway
is *structurally incapable* of knowing the broker is n8n: implement the contract
in one new class and nothing above the seam changes.

```
 route handlers ─┐
 services        ├─▶  Broker (interface, domain types)  ◀─ ReferenceBroker  (reference broker)
 exporter / BI  ─┘            src/broker/types.ts        ◀─ DemoBroker (canned data, no network)
```

- Interface + domain types: [`artifacts/api-server/src/broker/types.ts`](../artifacts/api-server/src/broker/types.ts)
- Selection + request→domain context: [`src/broker/index.ts`](../artifacts/api-server/src/broker/index.ts)
- n8n implementation (the reference broker — the **only** n8n-aware code): [`src/broker/reference-broker/index.ts`](../artifacts/api-server/src/broker/reference-broker/index.ts)
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
3. **Nothing above the seam imports the n8n adapter directly** (`../broker/reference-broker`)
   — except the one documented frozen-surface route below.

What this means concretely — these must **not** appear above the seam: the
webhook envelope (`{ action, payload, source, origin, idempotencyKey }`), the
`X-OmniProject-*` headers, n8n action strings (`list_projects`, `create_issue`,
…), n8n source labels (`capacity_engine`, …), or the `{ success, data, message }`
response shape. All of that lives in `ReferenceBroker`. (The broker endpoint is read
from the broker-named `BROKER_URL` — itself fine above the seam; what must not
leak is the n8n *webhook contract* it points at.)

### Public surface — fully broker-named

The public API/UI no longer names n8n anywhere it isn't genuinely about n8n. The
canonical surface is:

- `POST /api/broker/command` (request/response schemas `BrokerCommandInput` /
  `BrokerCommandResult`);
- `Settings.brokerUrl`;
- `BROKER_URL` env;
- `GET /api/setup/status` → `broker: { configured, urlSet }`.

The v0.1-era deprecated aliases (`/n8n-proxy`, `n8nWebhookUrl`,
`N8N_WEBHOOK_URL`, the `status.n8n` object) have been **removed**.

**Zero exceptions above the seam.** No file above the seam imports the adapter at
all — the command edges (`/broker/command` and the raw escape hatch) go through the
neutral `brokerCommand()` helper exported from the broker barrel, so the
adapter-import allowlist in `broker-guard.test.ts` is **empty** and the guard
asserts it stays that way.

The only remaining *intentional* n8n names are under/at the seam:

- **`src/broker/`** — the adapter itself (`reference-broker/index.ts`) and the barrel that exposes the
  neutral `brokerCommand()` helper;
- the **workflow generator**
  (`lib/backend-catalogue/src/backend-catalogue.ts`,
  `lib/backend-catalogue/src/workflow-generator.ts`) — emits n8n workflow JSON,
  n8n-specific by nature, alongside but logically under the seam;
- the Setup wizard's *"generate an n8n workflow"* copy — it really is about n8n.

## Demo mode is the DemoBroker

There is no longer a parallel "demo branch" interleaved into the callers. When no
backend is configured (`BROKER_URL` unset), `getBroker()` returns the
`DemoBroker`, which serves canned sample data with no network and no n8n. It is
both the offline/CI harness and the proof the seam is clean: the whole gateway
runs against it (see the `DemoBroker` unit test and the guard).

(DemoBroker is not the only non-n8n implementation: a first-party **built-in
broker** — [`artifacts/api-server/src/broker/builtin/`](../artifacts/api-server/src/broker/builtin/),
opt-in via `BUILTIN_BROKER`, over a pluggable memory/Postgres store — is a real
alternative adapter, selected in `broker/index.ts` when no `BROKER_URL` and no
dev broker are set.)

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
`FooBroker implements Broker`, point the selector at it, and delete `reference-broker/` (and
re-point `brokerCommand()` in the barrel). The data path, the API surface, the SPA,
and every test above the seam are untouched — because none of them ever knew the
broker was n8n. That is the property this boundary exists to guarantee.

## Building a broker out-of-process (HTTP sidecar)

A broker need not live in this repo at all. Because n8n is just an **HTTP broker**,
anything that speaks the same wire protocol plugs in by setting `BROKER_URL` — no
core change. The protocol (action catalogue, request envelope, control headers,
response/error mapping, optimistic concurrency) is specified in
[BROKER-HTTP-BINDING.md](BROKER-HTTP-BINDING.md). The first planned use is an
optional, separate **database broker** (OmniProject as system of record) — see
[design/RFC-003](archive/design/RFC-003-db-broker.md). The conformance suite
(`broker/conformance.ts`) is the acceptance test for any such broker.
