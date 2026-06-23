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

`artifacts/api-server/src/lib/n8n-backends.ts` holds a **manifest** per backend
declaring, for each contract action, the HTTP method / URL / body and the default
capability flags. Shipped reference manifests:

| Backend | Auth | Required n8n env | Notes |
| ------- | ---- | ---------------- | ----- |
| **OpenProject** | per-user Bearer | `OPENPROJECT_INSTANCE_URL` | work packages ↔ issues; `lockVersion` ↔ `version` gives real optimistic concurrency; baselines + journals → baseline/history |
| **Plane** | Bearer / X-API-Key | `PLANE_INSTANCE_URL`, `PLANE_WORKSPACE_SLUG` | swap Authorization for `X-API-Key` if using a service token |
| **Jira (Cloud)** | Basic | `JIRA_INSTANCE_URL`, `JIRA_BASIC_AUTH` | `JIRA_BASIC_AUTH` = base64(`email:token`); sprints/points via Agile fields |
| **GitHub Issues** | Bearer | `GITHUB_OWNER` | `projectId` = repo; no native dates (scheduling off); delete = close |
| **GitLab Issues** | Bearer | `GITLAB_INSTANCE_URL` | `projectId` = numeric project id |
| **Azure DevOps** | Basic (PAT) | `AZDO_ORG_URL`, `AZDO_BASIC_AUTH` | work-item writes need `application/json-patch+json` |

These are **reference mappings** — verify paths/fields against your backend
version; they're designed to be tweaked after import.

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

## Adding a backend

Add a `BackendManifest` to `n8n-backends.ts` (URLs are n8n expressions using
`$env.*` and `$json.body.payload.*`). The generator, wizard, verifier, and the
unit tests pick it up automatically — no other change required.

See also: [DATA-REQUIREMENTS.md](DATA-REQUIREMENTS.md) ·
[TECHNICAL.md](TECHNICAL.md) · [the blueprints](../artifacts/n8n-blueprints/).
