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
import { NOTIFICATIONS_DATA } from "./vendors.generated";

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

export const NOTIFICATIONS: NotificationDefinition[] = NOTIFICATIONS_DATA;

/** One notification channel by id, or undefined. */
export function getNotificationChannel(id: string): NotificationDefinition | undefined {
  return NOTIFICATIONS.find((n) => n.id === id);
}

/** All notification channels (a defensive copy). */
export function notificationCatalogue(): NotificationDefinition[] {
  return NOTIFICATIONS.map((n) => ({ ...n }));
}
