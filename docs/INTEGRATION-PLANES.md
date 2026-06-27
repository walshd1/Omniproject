# Integration planes — backends, brokers, outputs, notifications

OmniProject has **four integration planes**, and they all follow the same
architectural principle: a **neutral manifest** (identity + **capabilities**) kept
**separate from** its concrete **tools** (the how), the two **linked** into one
definition. All live in `@workspace/backend-catalogue` as pure, shared data so the
gateway and the setup wizard can't drift.

| Plane | What it is | Manifest (capabilities) | Tools (the how) | Registry |
| --- | --- | --- | --- | --- |
| **Backends** | systems of record (Jira, SAP, Salesforce, …) | domains it can populate (`issues`, `financials`, `crm`, …), required env, transport | the n8n binding (per-action node/HTTP mappings) + workflow generator | `backendCatalogue()` |
| **Brokers** | the automation/translation hop | `synchronous`, `selfHostable`, `managedAuth`, `eventsInbound/Outbound`; which transports it drives | the **build method** (workflow generator / scenario / DAG / component / flow / function / blueprint) | `brokerCatalogue()` |
| **Outputs** | outward interfaces (data/events out) | `readOnly`, `streaming`, `auth` | the concrete surface (MCP tool names, OData entity sets, export formats, event names) | `outputCatalogue()` |
| **Notifications** | channels alerts are delivered TO (Slack, Teams, email, PagerDuty, …) | `channels`, `directMessage`, `richFormatting`, `threads`, `inboundReply`, `delivery` | the event payloads it carries (`notification`, `alert`, `audit`, …) | `notificationCatalogue()` |

Surfaced read-only at `GET /api/setup/{backends,brokers,outputs,notifications}`.

## How the planes link

The planes are **separate but linked**, derived rather than hardcoded so they
can't drift:

- A **backend** declares a `transport` (`http` | `native-node`).
- `brokersForTransport(transport)` reads the **broker** registry and returns every
  broker that can serve it — i.e. **synchronous** brokers whose `transports`
  include it. So an `http` backend is reachable by n8n / Make / Pipedream / Power
  Automate / serverless / a custom sidecar; a `native-node` backend is n8n-only.
- The backend catalogue therefore reports, per backend, `transport` + `brokers`
  **derived from the broker plane** — change a broker's capabilities and the
  backend's reachable-brokers list updates automatically.

## The hard line for brokers: synchronous

The binding is request/response — the gateway POSTs and **waits for `{success,
data}` in the same call**. So a broker can be the live **data hop** only if it's
**synchronous**:

- **Data brokers (synchronous):** n8n, Make, Pipedream, Power Automate, serverless
  functions, a custom HTTP sidecar.
- **NOT data brokers (async):** **Airflow** (batch DAGs) — modelled honestly with
  `synchronous: false`. It can still do scheduled sync into a store a real broker
  reads, or push events. Same role as Zapier/IFTTT (event edges only).

## Reference architectures (one per plane)

Each plane has a **deliberately non-functional** reference to build from — complete
in shape, stubbed where only you can fill it in, so you can't just deploy the
reference as-is:

- **Backend** — `broker/reference-backend-blueprint.ts`
- **Broker** — `broker/reference-broker-blueprint.ts`
- **Output** — `broker/reference-output-blueprint.ts`

(Plus the runnable `reference-sidecar.ts` and the per-broker build templates the
broker registry's `build` field points at.)
