# Dev guide — the BROKERS plane

A broker is the automation/translation hop between the gateway and a backend. Add
one as a `BrokerDefinition` in `lib/backend-catalogue/src/broker-catalogue.ts`.

## Shape

```ts
{
  id: "my-broker",
  label: "My Broker",
  docsUrl: "…",
  kind: "low-code" | "code-first" | "serverless" | "self-hosted-service",
  hosted: false,
  capabilities: {
    synchronous: true,    // ← THE hard line: can it return {success,data} in the SAME request?
    selfHostable: true, managedAuth: false, eventsInbound: true, eventsOutbound: true,
  },
  transports: ["http"],   // "native-node" is n8n-only
  build: "function-template",   // how you build one for it (the linked tool)
  alsoProvides: [{ plane: "notifications" }],   // optional cross-plane
}
```

- **`synchronous` is the invariant — and it's always `true` here.** Only a
  synchronous broker can be the live data hop, so the broker plane is the
  synchronous-only plane: the schema enforces `synchronous: true` and a guard test
  backs it. Async platforms (Airflow, Zapier, IFTTT) can't serve read-through, so
  they are NOT brokers — they live in the **outputs** plane (scheduled egress, e.g.
  `vendors/outputs/airflow.json`, kind `batch-egress`) and/or the **notifications**
  plane (event delivery). Don't add them here.
- The `build` tool: a Node-runtime broker should reuse the shared
  **`processBrokerCall`** core (see `broker/templates/`) — add only the transport
  glue + your `backend`. Don't re-implement the binding.

## Verify + ship

```bash
pnpm --filter @workspace/scripts verify-plane brokers my-broker.json
```

Add to `BROKERS`; for a real implementation, point `BROKER_URL` at it and run the
runtime conformance suite (`broker/conformance.ts`) — that's the proof it works.
