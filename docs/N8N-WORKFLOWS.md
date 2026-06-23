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

`artifacts/api-server/src/lib/n8n-backends.ts` holds a **manifest** per backend.
Each action is implemented by one of two transports:

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

These are **reference mappings** — verify node operations / paths against your
instance; they're designed to be tweaked after import.

> **Auth tradeoff:** HTTP·per-user transports forward the active user's OIDC
> token (per-user audit in the backend). Native-node and managed-OAuth transports
> use a **single n8n service credential** — the common enterprise pattern, but
> writes are attributed to the service account, not the end user.

## Generate a workflow

- **UI:** Setup → Connection Center → *Generate an n8n workflow* → pick backend →
  **Download workflow** → in n8n: *Workflows → Import from File*.
- **API:** `POST /api/setup/generate-workflow { "backendId": "openproject" }`
  (admin) returns the importable JSON.
- **Catalogue:** `GET /api/setup/backends` lists what's available.

Each generated workflow is: `Webhook → Verify short-circuit → Loop guard →
Route(action) → per-action HTTP node → Normalize → Respond`, plus a
`Capabilities` node you edit to declare what your backend exposes.

## Verify a workflow

- **UI:** Setup → Connection Center → *Verify your workflow* → **Run
  verification** → green/red per-action checklist.
- **API:** `POST /api/setup/verify-workflow` (admin) probes the configured n8n
  with `{ verify: true }` for every **read/declarative** action and reports
  `{ action, ok, status, ms, verifyAware }[]`.
- **Safety:** write actions (`create/update/delete`) are **never** probed. The
  `verify: true` flag lets a generated workflow short-circuit so even reads don't
  touch the backend (the workflow returns `data.verified = true`).
- **CLI (full contract):** `OMNI_API_BASE=https://your-omni pnpm --filter @workspace/scripts run verify-n8n`.

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

## Adding a backend

Add a `BackendManifest` to `n8n-backends.ts` (URLs are n8n expressions using
`$env.*` and `$json.body.payload.*`). The generator, wizard, verifier, and the
unit tests pick it up automatically — no other change required.

See also: [DATA-REQUIREMENTS.md](DATA-REQUIREMENTS.md) ·
[TECHNICAL.md](TECHNICAL.md) · [the blueprints](../artifacts/n8n-blueprints/).
