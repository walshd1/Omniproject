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
  kind: "chat" | "email" | "incident" | "sms" | "webhook",
  capabilities: {
    channels: true, directMessage: false, richFormatting: true,
    threads: false, inboundReply: false,
    delivery: "incoming-webhook" | "oauth-app" | "api-key" | "smtp" | "hmac-webhook",
  },
  tools: ["notification", "alert", "audit"],   // the event payloads it carries
}
```

- Be honest about `inboundReply` (two-way) and `delivery` — these drive what the
  channel can actually do.
- **Delivery itself rides the broker / outbound-webhook seam** (e.g. an n8n
  workflow posts to Slack). This plane is the *catalogue*; you don't write the
  HTTP call here — you describe the channel + wire delivery in your broker.

## Verify + ship

```bash
pnpm --filter @workspace/scripts verify-plane notifications my-channel.json
```
