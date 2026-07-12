# Dev guide — the OUTPUTS plane

An output is an outward interface that exposes data/events (MCP, OData, BI, metrics,
exports, webhooks, calendars). Add one as an `OutputDefinition` in
`lib/backend-catalogue/src/output-catalogue.ts`, and implement the route.

## Shape

```ts
{
  id: "my-feed",
  label: "My Feed",
  route: "GET /api/my-feed",
  kind: "read-api" | "bi-feed" | "agent-api" | "export" | "metrics" | "events-out" | "events-in" | "batch-egress" | "calendar",
  capabilities: {
    readOnly: true,           // outputs must not mutate a backend (calendar pushes are the exception)
    streaming: false,
    auth: "session-or-token", // session | api-token | session-or-token | hmac | user-action | oauth2
  },
  transports: ["api", "mcp"], // OPTIONAL — the connection method(s) offered (calendars: api | mcp | ical-feed)
  tools: ["entity-or-format-names"],   // OData entity sets / MCP tools / export formats / calendar event kinds
}
```

### Calendars (`kind: "calendar"`)

Calendars publish scheduled work OUT — milestones, deadlines and task due/scheduled
dates — through the broker seam (no at-rest scope, never ingests events). Google
Calendar and Outlook Calendar are OAuth2 pushes offered over both a REST API and an
MCP server (`transports: ["api","mcp"]`, `readOnly: false`); iCal is a read-only
RFC 5545 `.ics` subscription feed OmniProject serves (`transports: ["ical-feed"]`,
`readOnly: true`).

## Implement

Outputs follow ONE shape — see the **reference output blueprint**
(`broker/reference-output-blueprint.ts`): `authenticate → read THROUGH the broker →
shape a read-only projection → serialise`. Reuse `serveOutput(deps)` and implement
only `shape`. The read goes through `getBroker()` so the output inherits RBAC +
audit and adds no at-rest scope.

## Verify + ship

```bash
pnpm --filter @workspace/scripts verify-plane outputs my-output.json
```

Add to `OUTPUTS`, mount the route, and add a route test.
