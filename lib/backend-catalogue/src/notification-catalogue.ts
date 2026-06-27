/**
 * NOTIFICATION registry — the channels OmniProject can deliver alerts/events TO
 * (Slack, Teams, …). The fourth integration plane, same architectural principle:
 * a neutral manifest (capabilities) kept SEPARATE from its tools (the event
 * payloads it carries), linked into one definition.
 *
 * Distinct from OUTPUTS (read interfaces / data egress): a notification channel is
 * a PUSH destination for human-facing alerts. Delivery itself rides the broker /
 * outbound-webhook seam (e.g. an n8n workflow posts to Slack) — this registry is
 * the catalogue of what's supported + how each authenticates.
 */

export type NotificationKind = "chat" | "email" | "incident" | "sms" | "webhook" | "iot" | "agent";

export interface NotificationCapabilities {
  /** Post to a shared channel/room. */
  channels: boolean;
  /** Direct-message an individual. */
  directMessage: boolean;
  /** Rich formatting (Slack Block Kit / Teams Adaptive Cards / embeds). */
  richFormatting: boolean;
  /** Threaded replies. */
  threads: boolean;
  /** Can route an inbound reply back in (two-way). */
  inboundReply: boolean;
  /** How it authenticates / is wired. */
  delivery: "incoming-webhook" | "oauth-app" | "api-key" | "smtp" | "hmac-webhook" | "mqtt" | "mcp";
}

export interface NotificationManifest {
  id: string;
  label: string;
  docsUrl: string;
  kind: NotificationKind;
  capabilities: NotificationCapabilities;
  notes?: string;
}

/** A catalogue entry: the manifest + the event payloads (tools) it carries. */
export interface NotificationDefinition extends NotificationManifest {
  tools: string[];
}

const EVENTS = ["notification", "alert", "audit", "config.changed"];

export const NOTIFICATIONS: NotificationDefinition[] = [
  {
    id: "slack", label: "Slack", docsUrl: "https://api.slack.com/messaging/webhooks", kind: "chat",
    capabilities: { channels: true, directMessage: true, richFormatting: true, threads: true, inboundReply: true, delivery: "incoming-webhook" },
    tools: EVENTS, notes: "Incoming Webhook for simple posts, or a Bot/OAuth app for DMs + threads + slash-command replies. Block Kit for rich messages.",
  },
  {
    id: "teams", label: "Microsoft Teams", docsUrl: "https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/connectors-using", kind: "chat",
    capabilities: { channels: true, directMessage: true, richFormatting: true, threads: true, inboundReply: false, delivery: "incoming-webhook" },
    tools: EVENTS, notes: "Incoming Webhook / Workflows connector for channel posts (Adaptive Cards), or Graph API for DMs.",
  },
  {
    id: "discord", label: "Discord", docsUrl: "https://discord.com/developers/docs/resources/webhook", kind: "chat",
    capabilities: { channels: true, directMessage: false, richFormatting: true, threads: true, inboundReply: false, delivery: "incoming-webhook" },
    tools: EVENTS, notes: "Channel webhook with embeds.",
  },
  {
    id: "email", label: "Email", docsUrl: "https://datatracker.ietf.org/doc/html/rfc5321", kind: "email",
    capabilities: { channels: false, directMessage: true, richFormatting: true, threads: false, inboundReply: false, delivery: "smtp" },
    tools: ["notification", "alert", "audit"], notes: "SMTP or a transactional-email API (SendGrid/SES/Postmark). HTML for rich.",
  },
  {
    id: "pagerduty", label: "PagerDuty", docsUrl: "https://developer.pagerduty.com/docs/events-api-v2/overview/", kind: "incident",
    capabilities: { channels: false, directMessage: false, richFormatting: false, threads: false, inboundReply: false, delivery: "api-key" },
    tools: ["alert", "audit"], notes: "Events API v2 — escalate a triggered/acknowledged/resolved incident (for SLA/health breaches).",
  },
  {
    id: "opsgenie", label: "Opsgenie", docsUrl: "https://docs.opsgenie.com/docs/alert-api", kind: "incident",
    capabilities: { channels: false, directMessage: false, richFormatting: false, threads: false, inboundReply: false, delivery: "api-key" },
    tools: ["alert", "audit"], notes: "Alert API — on-call escalation, an Atlassian-stack alternative to PagerDuty.",
  },
  {
    id: "twilio-sms", label: "SMS (Twilio)", docsUrl: "https://www.twilio.com/docs/sms", kind: "sms",
    capabilities: { channels: false, directMessage: true, richFormatting: false, threads: false, inboundReply: true, delivery: "api-key" },
    tools: ["alert"], notes: "Plain-text SMS for critical alerts; keep payloads tiny.",
  },
  {
    id: "generic-webhook", label: "Generic webhook", docsUrl: "https://github.com/walshd1/omniproject/blob/main/docs/BROKER-HTTP-BINDING.md", kind: "webhook",
    capabilities: { channels: false, directMessage: false, richFormatting: false, threads: false, inboundReply: false, delivery: "hmac-webhook" },
    tools: EVENTS, notes: "OmniProject's own HMAC-signed outbound events (the OUTPUTS `webhooks` surface) — point any consumer at it.",
  },
  {
    id: "mqtt", label: "MQTT", docsUrl: "https://mqtt.org/", kind: "iot",
    // Pub/sub to a broker topic. Two-way: a subscriber can also publish a command
    // back on a reply topic, so `inboundReply` is honestly true.
    capabilities: { channels: true, directMessage: false, richFormatting: false, threads: false, inboundReply: true, delivery: "mqtt" },
    tools: EVENTS, notes: "Publish events as JSON to an MQTT topic (e.g. omniproject/alerts) for IoT dashboards, building/ops systems, or any subscriber. Delivery rides the broker seam — an n8n/MQTT node (or the reference sidecar) does the publish; this plane describes the channel. QoS/retain are wired in your broker.",
  },
  {
    id: "mcp", label: "MCP (AI agent)", docsUrl: "https://modelcontextprotocol.io/", kind: "agent",
    // Delivered THROUGH the MCP server: an agent pulls notifications via the
    // read-only `omniproject_list_notifications` tool (and can act on them), so it
    // is structured + two-way, but there is no push — the agent polls.
    capabilities: { channels: false, directMessage: true, richFormatting: true, threads: false, inboundReply: true, delivery: "mcp" },
    tools: EVENTS, notes: "Surfaces notifications to an AI agent over OmniProject's MCP server (the OUTPUTS `mcp` surface), read via the omniproject_list_notifications tool. Pull-based (the agent polls), inheriting RBAC + audit; no outbound push.",
  },
];

export function getNotificationChannel(id: string): NotificationDefinition | undefined {
  return NOTIFICATIONS.find((n) => n.id === id);
}

export function notificationCatalogue(): NotificationDefinition[] {
  return NOTIFICATIONS.map((n) => ({ ...n }));
}
