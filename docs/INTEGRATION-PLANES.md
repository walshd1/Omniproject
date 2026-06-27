# Integration planes — seven of them

OmniProject has **seven integration planes**, and they all follow the same
architectural principle: a **neutral manifest** (identity + **capabilities**) kept
**separate from** its concrete **tools** (the how), the two **linked** into one
definition. All live in `@workspace/backend-catalogue` as pure, shared data so the
gateway and the setup wizard can't drift. The plane meta-registry
(`planeCatalogue()`, `GET /api/setup/planes`) lists every plane + its dev docs.

**Cross-plane:** an entry may span planes — declared with `alsoProvides`. E.g. the
n8n / Make brokers also deliver **notifications** (the same workflow posts to
Slack); a Scrum **methodology** also implies a burndown **report** + a board
**screen**.

| Plane | What it is | Manifest (capabilities) | Tools (the how) | Registry |
| --- | --- | --- | --- | --- |
| **Backends** | systems of record (Jira, SAP, Salesforce, …), plus an Excel/CSV **import** source and admin-gated raw **SQL** / **MongoDB** | domains it can populate (`issues`, `financials`, `crm`, …), `kind` (`live` \| `import` \| `database`), `adminOnly`, required env, transport | the n8n binding (per-action node/HTTP mappings) + workflow generator | `backendCatalogue()` |
| **Brokers** | the automation/translation hop | `synchronous`, `selfHostable`, `managedAuth`, `eventsInbound/Outbound`; which transports it drives | the **build method** (workflow generator / scenario / DAG / component / flow / function / blueprint) | `brokerCatalogue()` |
| **Outputs** | outward interfaces (data/events out) | `readOnly`, `streaming`, `auth` | the concrete surface (MCP tool names, OData entity sets, export formats, event names) | `outputCatalogue()` |
| **Notifications** | channels alerts are delivered TO (Slack, Teams, email, PagerDuty, …) | `channels`, `directMessage`, `richFormatting`, `threads`, `inboundReply`, `delivery` | the event payloads it carries (`notification`, `alert`, `audit`, …) | `notificationCatalogue()` |
| **Methodologies** | PM methodologies (Scrum, Kanban, Waterfall, SAFe, PRINCE2, …) | `iterations`, `board`, `wipLimits`, `phases`, `baseline`, `estimation` | the workflow `states` + `ceremonies` it introduces | `methodologyCatalogue()` |
| **Reports** | report / visualisation types (Gantt, burndown, EVM, …) | `requiresCapability` (links to backends), `timeSeries`, `exports` | the metrics / series it produces | `reportCatalogue()` |
| **Screens** | SPA views (Home, Gantt, Reports, Settings, …) | `requiresRole`, `requiresCapability`, `dataLineage`, `exportable` | the widgets on the screen | `screenCatalogue()` |

Surfaced read-only at `GET /api/setup/{backends,brokers,outputs,notifications,methodologies,reports,screens}` (+ `/planes`).

**Backend kinds.** A backend is `live` (a brokered SaaS/HTTP API, the default), an
`import` source (Excel/CSV — fed through the column mapper + `/api/import`, not
brokered live, so it lists no brokers), or a `database` (raw SQL / MongoDB reached
via an HTTP sidecar that holds the connection). `database` backends are `adminOnly`
and hidden from non-admins in the wizard. See
[ops/IMPORT.md](ops/IMPORT.md) and [ops/DATABASE-BACKENDS.md](ops/DATABASE-BACKENDS.md).

**Companion sub-registry — reference rulesets.** The methodologies plane has a
data companion, `referenceRulesetCatalogue()`: a curated **business-ruleset
bundle per methodology** (Scrum/Kanban/Waterfall/PRINCE2/SAFe) the PMO can apply
for compliance + completeness. It is just data in the same catalogue, so it
inherits the [restrict-only](ops/BUSINESS-RULES.md) safety guarantees of the rule
engine. Surfaced (PMO-gated) at `GET /api/admin/ruleset/reference`.

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
