# Dev guide — the OUTPUTS plane

An output is an outward interface that exposes data/events (MCP, OData, BI, metrics,
exports, webhooks). Add one as an `OutputDefinition` in
`lib/backend-catalogue/src/output-catalogue.ts`, and implement the route.

## Shape

```ts
{
  id: "my-feed",
  label: "My Feed",
  route: "GET /api/my-feed",
  kind: "read-api" | "bi-feed" | "agent-api" | "export" | "metrics" | "events-out" | "events-in",
  capabilities: {
    readOnly: true,           // outputs must not mutate a backend
    streaming: false,
    auth: "session-or-token", // session | api-token | session-or-token | hmac | user-action
  },
  tools: ["entity-or-format-names"],   // OData entity sets / MCP tools / export formats
}
```

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
