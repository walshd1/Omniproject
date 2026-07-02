# n8n Workflows — generate, wire & verify

The n8n workflow is where OmniProject meets your backend. To keep OmniProject
**stateless and decoupled**, all backend specifics live in the workflow (in your
n8n) — never in the app. This page covers the **backend library**, the
**workflow generator**, the **wizard**, and the **verifier**.

## The contract (recap)

The gateway brokers every data action to a single n8n webhook as:

```jsonc
{
  "action": "create_issue",
  "source": "openproject",        // free-form routing hint
  "origin": "omniproject",
  "idempotencyKey": "…",
  "verify": false,                 // true = verifier probe (no-op)
  "payload": {
    "projectId": "…", "issueId": "…", "expectedVersion": 3,
    "userContext": { "sub": "…", "email": "…", "token": "<oidc token>" }
  }
}
```

The workflow must reply with `{ success, data, message }` (the `N8nActionResult`).

## Backend library

`lib/backend-catalogue/src/backend-catalogue.ts` holds the `BACKENDS` array — a
**manifest** per backend (`BackendDefinition`, the broker-neutral
`BackendManifest` flattened with its n8n `N8nBinding`). Each backend's DATA is
authored as its own JSON file under `lib/backend-catalogue/vendors/backends/<id>.json`
(validated against `lib/backend-catalogue/vendors/schema/backend.schema.json`
and embedded by `pnpm --filter @workspace/scripts run gen-vendors`). Each
action is implemented by one of two transports:

- **Native n8n node** — where n8n ships a maintained node for the tool, the
  generated workflow uses *that node* with an n8n credential. This deliberately
  **moves the integration + auth risk onto n8n** (a much larger, maintained
  project) instead of our own HTTP mappings.
- **HTTP** — a raw HTTP Request node, either with the active user's bearer
  (per-user impersonation) or an **n8n-managed OAuth credential** (e.g. Microsoft
  Dynamics) where per-user tokens don't apply.

| Backend | Transport | Required n8n env / credential |
| ------- | --------- | ----------------------------- |
| **OpenProject** | HTTP · per-user OIDC | `OPENPROJECT_INSTANCE_URL` |
| **Plane** | HTTP · per-user / X-API-Key | `PLANE_INSTANCE_URL`, `PLANE_WORKSPACE_SLUG` |
| **Jira (Cloud)** | HTTP · Basic | `JIRA_INSTANCE_URL`, `JIRA_BASIC_AUTH` |
| **GitHub Issues** | HTTP · per-user | `GITHUB_OWNER` |
| **GitLab Issues** | HTTP · per-user | `GITLAB_INSTANCE_URL` |
| **Azure DevOps** | HTTP · Basic (PAT) | `AZDO_ORG_URL`, `AZDO_BASIC_AUTH` |
| **Asana** | **Native node** | `asanaApi` credential, `ASANA_WORKSPACE_ID` |
| **Monday.com** | **Native node** | `mondayComApi` credential |
| **ServiceNow (PPM)** | **Native node** | `serviceNowBasicApi` credential |
| **Trello** | **Native node** | `trelloApi` credential |
| **Wrike** | **Native node** | `wrikeOAuth2Api` credential |
| **ClickUp** | **Native node** | `clickUpApi` credential, `CLICKUP_SPACE_ID` |
| **Microsoft Dynamics 365** | HTTP · n8n-managed OAuth | `microsoftDynamicsOAuth2Api` credential, `DATAVERSE_URL` |
| **Microsoft Project (for the web)** | HTTP · n8n-managed OAuth | `microsoftDynamicsOAuth2Api` credential, `DATAVERSE_URL` |
| **SAP S/4HANA** (Enterprise Project / PS) | HTTP · n8n OAuth2 (OData) | `oAuth2Api` credential, `SAP_S4_URL` |
| **Oracle Primavera P6 EPPM** | HTTP · n8n Basic | `httpBasicAuth` credential, `P6_URL` |
| **Enterprise backbone** (Capita / custom REST/OData/SOAP) | HTTP · n8n credential | `httpHeaderAuth` credential, `BACKBONE_BASE_URL` |

These are **reference mappings** — verify node operations / paths against your
instance; they're designed to be tweaked after import.

> **Auth tradeoff:** HTTP·per-user transports forward the active user's OIDC
> token (per-user audit in the backend). Native-node and managed-OAuth transports
> use a **single n8n service credential** — the common enterprise pattern, but
> writes are attributed to the service account, not the end user.

> **Heavyweight backbones (SAP, Capita, Primavera):** these are reference OData/
> REST mappings. SAP OData writes need the `X-CSRF-Token` fetch handshake; for
> classic SAP RFC/BAPI use an SAP community node or SAP Integration Suite. The
> generic **Enterprise backbone** preset is the starting point for bespoke
> systems (Capita platforms, ESB/SOA gateways, mainframe-fronting REST); for SOAP
> send XML from the HTTP node, and for message buses (IBM MQ, Kafka, RabbitMQ)
> trigger from the matching n8n node.

## Backup & restore (config snapshots)

OmniProject is stateless, so the only thing worth backing up is the gateway
*configuration*. Setup → *Backup & restore* (or the API) gives you a portable
JSON snapshot to take before a risky change or a port, and to restore if setup
goes wrong:

- `GET /api/setup/snapshot` (admin) — downloads `{ schema, version, createdAt,
  settings }` (n8n URL, AI provider/model, backend source, OIDC issuer).
- `POST /api/setup/restore` (admin) — validates the snapshot and applies it,
  returning any warnings (unknown/missing keys are reported, not fatal).

Secrets (`SESSION_SECRET`, `OIDC_CLIENT_SECRET`, `NOTIFY_INGEST_SECRET`,
`REDIS_URL`) are **not** in the snapshot — they live in the environment. To move
a whole instance, pair the snapshot with the env **config export** (Setup → step
3).

## Generate a workflow

- **UI:** Setup → Connection Center → *Generate an n8n workflow* → pick backend →
  **Download workflow** → in n8n: *Workflows → Import from File*.
- **API:** `POST /api/setup/generate-workflow { "backendId": "openproject" }`
  (admin) returns the importable JSON.
- **Catalogue:** `GET /api/setup/backends` lists what's available.

Each generated workflow is: `Webhook → Verify short-circuit → Loop guard →
Route(action) → per-action HTTP node → Normalize → Respond`, plus a
`Capabilities` node you edit to declare what your backend exposes.

### What's open vs. licensed (and what's a service)

The **tools to build workflows are open** — only the *prebuilt enterprise
integrations* are licensed:

- **Free, Apache-2.0, ungated:** the generator
  (`lib/backend-catalogue/src/n8n-generator.ts`), the manifest library
  (`lib/backend-catalogue/src/backend-catalogue.ts` + the vendor JSON), the
  contract above, the verifier, and generating a workflow for any **standard**
  backend (Jira, GitHub, GitLab, Azure
  DevOps, OpenProject, Plane, ServiceNow, Asana, Monday, Trello, Wrike, ClickUp).
  [Adding your own backend](#adding-a-backend) is free too — nothing about *how*
  to build a workflow is black-boxed.
- **Licensed feature (`enterprise_workflows`):** generating the prebuilt
  workflows for the heavyweight backbones — **SAP S/4HANA, Oracle Primavera P6,
  Microsoft Dynamics 365 / Project**. For those, `POST /api/setup/generate-workflow`
  returns **`402`** without a valid `LICENSE_KEY`. You're paying for the *prebuilt*
  integration so you don't have to build it — not for permission to build one. You
  can still wire any of these yourself for free with the same open generator plus
  the generic **Enterprise backbone** preset; the contract and tools are identical.
  Note the licence entitles **use, not warranty or support** — the premium
  components are AS IS (see
  [LICENSING.md → Status & warranty](../LICENSING.md#status--warranty)).
- **Optional paid service:** if you'd rather not build it, we can build and tune a
  workflow for your backend as an engagement — selling our time, not access. What
  we deliver is ordinary open source you own. See
  [LICENSING.md → Licensed features vs. professional services](../LICENSING.md#licensed-features-vs-professional-services).

## Verify a workflow

- **UI:** Setup → Connection Center → *Verify your workflow* → **Run
  verification** → green/red per-action checklist.
- **API:** `POST /api/setup/verify-workflow` (admin) probes the configured n8n
  with `{ verify: true }` for every **read/declarative** action and reports
  `{ action, ok, status, ms, verifyAware }[]`.
- **Safety:** write actions (`create/update/delete`) are **never** probed. The
  `verify: true` flag lets a generated workflow short-circuit so even reads don't
  touch the backend (the workflow returns `data.verified = true`).
- **CLI (full contract):** `OMNI_API_BASE=https://your-omni pnpm --filter @workspace/scripts run verify-broker`.

## Real-time notifications — wire in tools like ntfy / Slack

Managers can get notifications in real time **if they wish**, without OmniProject
storing anything or coupling to a specific tool. Two cooperating pieces:

1. **In-app live channel (provided):** the browser opens an SSE stream at
   `GET /api/notifications/stream` (session-authed). The bell updates instantly
   and shows a green **LIVE** dot; each user can toggle it off.
2. **Inbound ingest (provided):** `POST /api/notifications/ingest` accepts an
   event and fans it out to matching live clients. It's authenticated by
   `NOTIFY_INGEST_SECRET` (Bearer) and **disabled until that secret is set**.

```jsonc
// POST /api/notifications/ingest   Authorization: Bearer <NOTIFY_INGEST_SECRET>
{
  "target": { "role": "manager" },          // or { "sub": "…" } / { "email": "…" } / omit = broadcast
  "notification": { "kind": "blocker", "title": "Risk escalated on Platform Rewrite", "body": "…", "projectId": "proj-001" }
}
```

**Wiring external delivery (the decoupled part):** in your n8n workflow, when a
backend event fires (or on a schedule), fan out to the tools each manager wants —
e.g. an **ntfy** topic, **Slack**/Teams webhook, email, or push — *and* POST the
same event to `/api/notifications/ingest` for the live in-app bell. Per-user
channel preferences live in your backend/IdP (read them in n8n), so OmniProject
stays stateless. The `NOTIFY_INGEST_SECRET` is emitted by the Setup wizard's
config export.

### Scaling real-time across replicas — Redis, not Kafka

The in-app fan-out is in-process by default (fine for a single replica). For
multi-replica HA, set `REDIS_URL` and install `ioredis`
(`pnpm --filter @workspace/api-server add ioredis`) — `/ingest` then publishes to
a **Redis Pub/Sub** channel and every replica delivers to its own SSE clients.
Setup → *Status* shows the active fan-out (`in-process` vs `redis`).

Why Redis and not Kafka: this is **ephemeral broadcast** (push a toast to whoever
is connected; missed events fall back to the polled list). Redis Pub/Sub is
purpose-built for it — sub-ms, tiny footprint. Kafka is a durable partitioned log
for high-throughput streaming/replay; it's heavy ops and unnecessary latency
here. If Kafka is already your enterprise event backbone, **bridge it into
`/api/notifications/ingest`** (an n8n Kafka trigger → ingest) — upstream of the
fan-out, which stays Redis.

## Adding a backend

Drop a new `<id>.json` file under `lib/backend-catalogue/vendors/backends/`
(URLs are n8n expressions using `$env.*` and `$json.body.payload.*`), validated
against `lib/backend-catalogue/vendors/schema/backend.schema.json`, then run
`pnpm --filter @workspace/scripts run gen-vendors` to embed it. The generator,
wizard, verifier, and the unit tests pick it up automatically — no other change
required. See `docs/dev/PLANE-BACKENDS.md` for the shape.

See also: [DATA-REQUIREMENTS.md](DATA-REQUIREMENTS.md) ·
[TECHNICAL.md](TECHNICAL.md) · [the blueprints](../artifacts/n8n-blueprints/).
