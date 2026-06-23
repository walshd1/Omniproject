# n8n Blueprints

Importable n8n workflows that implement the OmniProject gateway contract so you
don't have to wire the nodes by hand.

## Generate one for your backend (recommended)

You usually shouldn't edit these by hand. Open **Setup → Connection Center** in
the app (or `POST /api/setup/generate-workflow`) and pick your backend — it emits
a complete, importable workflow tailored to that system. Then **Setup → Verify**
probes your live n8n per action and shows a green/red checklist.

- The backend library lives in `artifacts/api-server/src/lib/n8n-backends.ts`
  (OpenProject, Plane, Jira, GitHub, GitLab, Azure DevOps — add your own).
- The generator is `artifacts/api-server/src/lib/n8n-generator.ts` (pure JSON).
- Pre-generated examples are in [`generated/`](./generated/).

Generated workflows include a **verify short-circuit**: when the verifier sends
`{ "verify": true }`, the workflow returns a no-op acknowledgement so probing
never touches your backend. See [docs/N8N-WORKFLOWS.md](../../docs/N8N-WORKFLOWS.md).

## `omniproject-core-sync.json`

A production-shaped reference workflow that backs the core CRUD actions for
**Plane** and **OpenProject** (swap the HTTP node URLs for any other backend).

### What it does

1. **Webhook** (`POST /webhook/omniproject`) receives the gateway's contract:
   ```jsonc
   {
     "action": "create_issue",
     "source": "plane",            // routing hint (free-form)
     "origin": "omniproject",      // who initiated the change
     "idempotencyKey": "…",        // also sent as X-OmniProject-Idempotency-Key
     "payload": {
       "projectId": "…", "issueId": "…",
       "userContext": { "sub": "…", "email": "…", "token": "<oidc access token>" }
     }
   }
   ```
2. **Loop guard** — drops echo events where `origin === payload.lastUpdatedBy`,
   preventing circular Plane↔OpenProject webhook storms.
3. **Route Action** — switches on `list_projects | list_issues | create_issue |
   update_issue` (with a fallback for unsupported actions).
4. **HTTP nodes** call Plane (`PLANE_INSTANCE_URL`) or OpenProject
   (`OPENPROJECT_INSTANCE_URL`) and authenticate **as the active user** via
   `Bearer {{ $json.body.payload.userContext.token }}` — preserving per-user
   auditing instead of a shared admin key. Writes stamp `lastUpdatedBy = origin`.
5. **Normalize** returns the `N8nActionResult` shape the gateway expects:
   `{ success, data, message }`.

### Setup

1. In n8n: **Workflows → Import from File** → select this JSON.
2. Set the n8n environment variables `PLANE_INSTANCE_URL` and
   `OPENPROJECT_INSTANCE_URL` (e.g. `https://plane.example.com`).
3. Adjust the HTTP node paths to match your backend API versions (the defaults
   are illustrative `/api/v1/...` routes).
4. Activate the workflow and point the gateway at it via `N8N_WEBHOOK_URL`
   (e.g. `https://n8n.example.com/webhook/omniproject`).

### Notes

- The token in `userContext.token` is the end user's OIDC access token forwarded
  by the gateway. Ensure your backends accept it (e.g. OIDC-federated Plane /
  OpenProject), or exchange it for a backend token inside an extra node.
- The workflow is a starting point — extend the switch with `delete_issue`,
  `project_summary`, `list_activity`, etc. following the same pattern.
