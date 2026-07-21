import { CANONICAL_STATUS, WORK_PRIORITIES, STATUS_LABEL, PRIORITY_LABEL } from "@workspace/backend-catalogue";

/** The list-row fields whose fill rate is worth surfacing on the projects index/dashboard. */
export const PROJECT_FIELDS = [
  { key: "description", label: "Description" },
  { key: "programmeName", label: "Programme" },
  { key: "memberCount", label: "Members" },
  { key: "issueCount", label: "Issues" },
];

// The status/priority IDS, ORDER and LABELS come from the shared work-vocabulary asset (the single
// source of truth the gateway also reads) — see below. Only the Tailwind colour/accent CLASSES stay
// hand-written here, keyed by id: they MUST be literal class strings so Tailwind's content scanner
// keeps them (a computed `bg-${token}-500` would be purged from the build).
export const STATUS_COLORS: Record<string, string> = {
  backlog: "bg-zinc-500",
  todo: "bg-blue-500",
  in_progress: "bg-amber-500",
  in_review: "bg-purple-500",
  done: "bg-green-500",
  cancelled: "bg-red-500",
};

export const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-zinc-500",
  none: "bg-transparent",
};

// Ordered board columns (left → right) + ranked priorities — derived from the shared vocabulary asset.
export const STATUS_ORDER: readonly string[] = CANONICAL_STATUS;
export const PRIORITY_ORDER: readonly string[] = WORK_PRIORITIES;

// Upper-cased display labels, derived from the asset's canonical labels (the SPA renders status/priority
// pills in caps). Deriving them means adding a status to the asset surfaces it here automatically.
export const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  CANONICAL_STATUS.map((s) => [s, STATUS_LABEL[s].toUpperCase()]),
);
export const PRIORITY_LABELS: Record<string, string> = Object.fromEntries(
  WORK_PRIORITIES.map((p) => [p, PRIORITY_LABEL[p].toUpperCase()]),
);

// Accent border for each column header (left→right pipeline feel).
export const STATUS_ACCENTS: Record<string, string> = {
  backlog: "border-t-zinc-500",
  todo: "border-t-blue-500",
  in_progress: "border-t-amber-500",
  in_review: "border-t-purple-500",
  done: "border-t-green-500",
  cancelled: "border-t-red-500",
};

// ── Graceful fallbacks for backend-agnostic status/priority values ────────────
// OmniProject is backend-agnostic: a backend may surface status/priority strings
// that aren't in the conventional sets above (e.g. Jira's "To Do", ServiceNow
// states). These helpers degrade gracefully — a neutral swatch + a humanised
// label ("in_review" → "IN REVIEW") — instead of rendering nothing.
function humanise(value: string): string {
  return value.replace(/[_-]+/g, " ").trim().toUpperCase();
}
export const statusColor = (status: string): string => STATUS_COLORS[status] ?? "bg-zinc-400";
export const statusAccent = (status: string): string => STATUS_ACCENTS[status] ?? "border-t-zinc-400";
export const statusLabel = (status: string): string => STATUS_LABELS[status] ?? humanise(status);
export const priorityColor = (priority: string): string => PRIORITY_COLORS[priority] ?? "bg-zinc-400";
export const priorityLabel = (priority: string): string => PRIORITY_LABELS[priority] ?? humanise(priority);
