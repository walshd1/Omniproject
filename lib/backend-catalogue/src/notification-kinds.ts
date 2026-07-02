/**
 * NOTIFICATION KINDS — the canonical vocabulary of event kinds a notification can
 * carry (assignment, due_soon, blocker, …), each tagged with a severity. One source
 * the dispatch routing, the ingest, and the in-app bell all read, so a kind isn't a
 * bare string scattered across demo data, routing JSON and the UI. This is the
 * notification-plane analogue of the canonical status/priority vocabularies.
 */

export type NotificationSeverity = "info" | "warning" | "critical";

export interface NotificationKindDef {
  id: string;
  label: string;
  severity: NotificationSeverity;
}

export const NOTIFICATION_KINDS: NotificationKindDef[] = [
  { id: "info", label: "Information", severity: "info" },
  { id: "assignment", label: "Assignment", severity: "info" },
  { id: "mention", label: "Mention", severity: "info" },
  { id: "due_soon", label: "Due soon", severity: "warning" },
  { id: "overdue", label: "Overdue", severity: "warning" },
  { id: "blocker", label: "Blocker", severity: "critical" },
  { id: "incident", label: "Incident", severity: "critical" },
  { id: "digest", label: "Digest", severity: "info" },
];

/** The known kind ids — the set routing rules / the guard validate against. */
export const KNOWN_NOTIFICATION_KINDS: ReadonlySet<string> = new Set(NOTIFICATION_KINDS.map((k) => k.id));

/** One kind definition by id, or undefined. */
export function getNotificationKind(id: string): NotificationKindDef | undefined {
  return NOTIFICATION_KINDS.find((k) => k.id === id);
}

/** All kind definitions (a defensive copy). */
export function notificationKindCatalogue(): NotificationKindDef[] {
  return NOTIFICATION_KINDS.map((k) => ({ ...k }));
}

/** The severity of a kind — defaults to "info" for an unknown/free-form kind. */
export function notificationSeverity(id: string): NotificationSeverity {
  return getNotificationKind(id)?.severity ?? "info";
}
