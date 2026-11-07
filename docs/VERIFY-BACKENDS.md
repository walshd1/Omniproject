# Verifying backends against live instances

The catalogue's `verification` field is an honesty signal: `catalogued` means
"built from the vendor's public API docs, never run against a real instance".
The catalogue is **frozen at 42 backends** until the five flagship connectors
below are `verified` (see `scripts/src/lib/backend-freeze.ts` and
`lib/backend-catalogue/vendors/README.md#catalogue-freeze`). "Verified" is
earned, not declared: a live **read + write round trip** through the backend's
own catalogued action mappings.

`verify-backend` is the mechanical runner for that. It executes the manifest's
EXACT templates — the same strings the generated n8n workflow embeds — so a
pass certifies the catalogue entry, not a hand-written approximation:

```sh
pnpm --filter @workspace/scripts run verify-backend -- --backend <id> [--write] [--project <id|key>] [--webhook <url>] [--flip]
```

- Reads (`list_projects`, `list_issues`) run by default and are safe.
- `--write` adds the round trip: `create_issue` → `update_issue` → `delete_issue`
  (the probe is titled `OmniProject verification probe <timestamp>` and always
  cleaned up; a failed cleanup names the leftover loudly). **Point it at a
  sandbox project** — it writes real records.
- Evidence is written to `lib/backend-catalogue/vendors/verification/<id>.json`
  (statuses and shape notes only — never credentials, never response bodies).
  Commit it alongside the flip.
- `--flip` rewrites the vendor JSON to `"verification": "verified"` — only
  offered when the full read+write pass succeeded. Then regenerate and commit:
  `pnpm --filter @workspace/scripts run gen-vendors && pnpm --filter @workspace/scripts run gen-workflow-blueprints`.

## Two modes

**Direct** (default) — for `http`-transport backends (`jira`, `sap`): the runner
evaluates the manifest's URL/body/auth templates locally and calls the vendor
API straight. Needs the backend's `requiredEnv` set in your shell.

**Webhook** (`--webhook <url>`) — required for native-node backends (`asana`,
`salesforce`, `servicenow`), whose integration lives in n8n's maintained nodes:

1. Download the generated workflow: Setup → backend tile → *Generate workflow*
   (or `POST /api/setup/generate-workflow`).
2. Import it into a live n8n, attach the named credential (e.g. `asanaApi`),
   and activate it.
3. Point `--webhook` at the workflow's production webhook URL.

The runner first sends the `{ verify: true }` handshake (proving the workflow
implements the contract scaffold without touching the backend), then drives the
same read/write actions through the `{ action, payload, origin, idempotencyKey }`
envelope. Direct-capable backends can also be run this way to certify the
n8n path end-to-end.

## Per-flagship checklists

### jira (direct)

| Env | Value |
| --- | --- |
| `JIRA_INSTANCE_URL` | `https://<site>.atlassian.net` |
| `JIRA_BASIC_AUTH` | base64 of `email:api-token` — token from id.atlassian.com → Security → API tokens |

```sh
JIRA_INSTANCE_URL=https://acme.atlassian.net \
JIRA_BASIC_AUTH=$(printf '%s' 'you@example.com:ATATT…' | base64 -w0) \
pnpm --filter @workspace/scripts run verify-backend -- --backend jira --write --project SANDBOX --flip
```

A free Jira Cloud site (up to 10 users) is enough; use a throwaway project key.

### sap (direct)

| Env | Value |
| --- | --- |
| `SAP_S4_URL` | the S/4HANA gateway base, e.g. `https://my3…-api.s4hana.cloud.sap` |

Auth note: the catalogued mappings assume the broker/network layer carries the
credential (mTLS or a gateway-injected header). For a standalone run against the
S/4HANA Cloud sandbox, front the instance with a proxy that injects
`APIKey`/basic auth, or run webhook mode through n8n with an HTTP credential.
The API used is `API_ENTERPRISE_PROJECT_SRV` (Enterprise Projects); a free
trial sandbox is available via api.sap.com.

### asana (webhook)

n8n credential `asanaApi` (a PAT from app.asana.com → Settings → Apps →
Developer apps). Set `ASANA_WORKSPACE_ID` as an n8n environment variable (the
workflow's nodes reference `$env.ASANA_WORKSPACE_ID`). Free workspace is enough.

### salesforce (webhook)

n8n credential `salesforceOAuth2Api` (a Connected App in a free Developer
Edition org). Projects map to Accounts, issues to Tasks — expect the round trip
on those objects.

### servicenow (webhook)

n8n credential `serviceNowBasicApi` against a free Personal Developer Instance
(developer.servicenow.com). The mappings target `pm_project` / task tables —
the PDI ships the Project Management plugin; activate it first.

## What CI runs without a tenant

`verify-backend.test.ts` keeps the runner itself honest offline: the template
evaluator is pinned against the real jira/sap manifests, every `http` template
in the whole catalogue must evaluate to a valid URL (a compile check for
catalogue authors), and both transports run full mock round trips — auth
header, idempotency key on writes, probe cleanup, handshake-first ordering.
None of that flips anything: only a live pass with `--write` does.
