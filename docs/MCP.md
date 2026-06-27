# MCP (Model Context Protocol) server

OmniProject speaks **MCP**, so any MCP client — Claude Desktop, an IDE, an agent —
can read the portfolio through the **same broker seam, RBAC and audit** as
everything else. It's an outward read interface (like the OData/BI endpoints), not
a broker: tools resolve to contract reads via the active broker, so the overlay
stays stateless and the agent inherits capability-gating and the audit trail.

- **Endpoint:** `POST /api/mcp` — JSON-RPC 2.0 (protocol `2024-11-05`).
- **Transport:** plain HTTP JSON-RPC (dependency-free; no MCP SDK committed).
- **Auth:** a session cookie **or** a read-only API token (the v1 tools are
  read-only, so a BI token is enough). `401` otherwise.
- **Methods:** `initialize`, `tools/list`, `tools/call`, `ping`, and the
  `notifications/*` no-ops.

## Tools (read-only, v1)

| Tool | Reads | Args |
| --- | --- | --- |
| `omniproject_list_projects` | projects/programmes | — |
| `omniproject_list_issues` | work items in a project | `projectId` |
| `omniproject_project_summary` | roll-up (totals, completion %, overdue) | `projectId` |
| `omniproject_portfolio_health` | portfolio RAG / health | — |
| `omniproject_capabilities` | which capability domains the backend supports | — |
| `omniproject_list_reports` | report types available for this backend (Gantt/burndown/EVM/…) | — |
| `omniproject_list_screens` | SPA screens the caller can open (+ each route) | — |
| `omniproject_list_notifications` | the user's recent notifications/alerts (the MCP notification channel) | — |

`list_reports` and `list_screens` tie MCP to the **reports** and **screens** planes,
filtered to what's actually usable — a report only appears if the active backend
declares the capability it needs, and a screen only if the caller's role clears its
`requiresRole` (and the backend can feed it). So an agent discovers an honest menu
("show me the EVM report", "open the Gantt for project X") rather than dead options.
`list_notifications` is the pull side of the **MCP notification channel**.

## Write tools — ⚠️ here be dragons (opt-in, double-gated)

Write tools let an **agent mutate your real backend** through the gateway, so they
are **off by default** and double-gated:

| Gate | Requirement |
| --- | --- |
| **Server** | `MCP_WRITE_ENABLED` must be set (`1`/`true`/`on`). Until then the server looks read-only: write tools aren't even advertised in `tools/list`, and a call returns JSON-RPC `-32004`. |
| **Caller** | a **contributor+ session** — never a read-only API token (a leaked BI token can't write). Otherwise `-32004`. |

When enabled, the tools are `omniproject_create_issue`, `omniproject_update_issue`
(supports `expectedVersion` for optimistic concurrency), and
`omniproject_delete_issue` (**irreversible**). Each carries the ⚠️ warning in its
description so the model sees it, each write goes through the broker's RBAC + write
path, and each is audited (`category: broker`, `write: true`). Leave
`MCP_WRITE_ENABLED` unset to keep MCP strictly read-only.

## Configuring a client

Point an MCP client at the endpoint with a bearer token (an API token, or a
session). With the streamable-HTTP transport:

```jsonc
{
  "mcpServers": {
    "omniproject": {
      "url": "https://omniproject.example.com/api/mcp",
      "headers": { "Authorization": "Bearer <API_TOKEN>" }
    }
  }
}
```

Quick smoke with curl:

```bash
curl -s https://omniproject.example.com/api/mcp \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"omniproject_list_projects","arguments":{}}}'
```

## Safety

Every tool call goes through `getBroker()` + the request's `ActorContext`, so the
backend still authorises the read with the user's forwarded token, capability
domains still gate what's available, and each `tools/call` is recorded in the
audit trail (`action: "mcp:<tool>"`). Nothing new is stored; results are computed
per request like any other read.
