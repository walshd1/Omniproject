# Dev guide — the NOTIFICATIONS plane

A notification channel is a push destination for alerts (Slack, Teams, email,
PagerDuty, …). Add one as a `NotificationDefinition` in
`lib/backend-catalogue/src/notification-catalogue.ts`.

## Shape

```ts
{
  id: "my-channel",
  label: "My Channel",
  docsUrl: "…",
  kind: "chat" | "email" | "incident" | "sms" | "webhook" | "iot" | "agent",
  capabilities: {
    channels: true, directMessage: false, richFormatting: true,
    threads: false, inboundReply: false,
    delivery: "incoming-webhook" | "oauth-app" | "api-key" | "smtp" | "hmac-webhook" | "mqtt" | "mcp",
  },
  tools: ["notification", "alert", "audit"],   // the event payloads it carries
}
```

- Be honest about `inboundReply` (two-way) and `delivery` — these drive what the
  channel can actually do.
- **Delivery itself rides the broker / outbound-webhook seam** (e.g. an n8n
  workflow posts to Slack). This plane is the *catalogue*; you don't write the
  HTTP call here — you describe the channel + wire delivery in your broker.

### Beyond chat/email — IoT and agents

- **`mqtt`** (`kind: "iot"`) — publish events as JSON to an MQTT topic for IoT
  dashboards / ops systems. Pub/sub is two-way (`inboundReply: true`); your broker
  (an n8n MQTT node or the reference sidecar) does the publish + sets QoS/retain.
- **`mcp`** (`kind: "agent"`) — surface notifications to an AI agent over the MCP
  server (the OUTPUTS `mcp` surface). It's **pull-based**: the agent reads them via
  the `omniproject_list_notifications` tool, inheriting RBAC + audit. No outbound
  push, so model it honestly (`channels: false`, `delivery: "mcp"`).

## Verify + ship

```bash
pnpm --filter @workspace/scripts verify-plane notifications my-channel.json
```
