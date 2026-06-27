/**
 * NOTIFICATION ROUTING — the generic, above-the-seam DISPATCH engine: given an
 * event, decide which delivery channels it should go to (and to whom). The rules
 * are JSON (assets/notification-routes/<id>.json, validated + embedded by
 * gen-notification-routes), so adding/altering routing is a config edit, not code —
 * the same pattern as views.
 *
 * The seam line: this module only DECIDES targets (dispatch). DELIVERY — actually
 * posting to Slack / sending the email / paging PagerDuty — stays BELOW the seam
 * (the broker / notification adapter does it). So a route names catalogue channel
 * ids; it never knows how any channel is wired. One engine, both planes gated by
 * the same compatibility idea: a channel is only a target if it's available.
 */
import { ROUTES_DATA } from "./notification-routes.generated";

export interface NotificationRouteMatch {
  /** Notification kinds this route fires on; "*" = any kind. */
  kinds: string[];
}

export interface NotificationAudience {
  /** RBAC role the dispatch is for (omitted = everyone / channel default). */
  role?: "viewer" | "contributor" | "manager" | "admin";
}

export interface NotificationRoute {
  id: string;
  label: string;
  description: string;
  match: NotificationRouteMatch;
  /** Delivery channel ids from the notification catalogue. */
  channels: string[];
  audience?: NotificationAudience;
  /** Methodology tags — "*" = neutral/always. */
  methodologies: string[];
  order: number;
}

/** The event a route is evaluated against (a subset of the ingested notification). */
export interface NotificationEvent {
  kind: string;
}

/** One resolved delivery target: which channel, from which route, for whom. */
export interface DeliveryIntent {
  route: string;
  channel: string;
  audience: NotificationAudience | null;
}

/** Every shipped routing rule, in evaluation order. */
export const NOTIFICATION_ROUTES: NotificationRoute[] = [...ROUTES_DATA].sort((a, b) => a.order - b.order);

/** One route by id, or undefined. */
export function getNotificationRoute(id: string): NotificationRoute | undefined {
  return NOTIFICATION_ROUTES.find((r) => r.id === id);
}

/** All routing rules (a defensive copy). */
export function notificationRouteCatalogue(): NotificationRoute[] {
  return NOTIFICATION_ROUTES.map((r) => ({ ...r }));
}

/** Does a route's predicate match an event? ("*" in kinds = any kind.) */
export function routeMatches(route: NotificationRoute, event: NotificationEvent): boolean {
  return route.match.kinds.includes("*") || route.match.kinds.includes(event.kind);
}

/**
 * The dispatch decision: the de-duplicated set of delivery intents for an event.
 * Every matching route contributes its channels; `isChannelAvailable` is the gate
 * (default: a channel must exist) so a route can never dispatch to a channel the
 * deployment can't deliver — the notification-plane analogue of the compatibility
 * predicate. De-duplicated by channel+audience (two routes naming the same channel
 * for the same audience collapse to one intent). Order follows route `order`.
 */
export function routeNotification(
  event: NotificationEvent,
  isChannelAvailable: (channelId: string) => boolean = () => true,
): DeliveryIntent[] {
  const out: DeliveryIntent[] = [];
  const seen = new Set<string>();
  for (const route of NOTIFICATION_ROUTES) {
    if (!routeMatches(route, event)) continue;
    const audience = route.audience ?? null;
    for (const channel of route.channels) {
      if (!isChannelAvailable(channel)) continue;
      const key = `${channel}|${audience?.role ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ route: route.id, channel, audience });
    }
  }
  return out;
}
