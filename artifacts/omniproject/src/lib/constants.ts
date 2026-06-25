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

export const STATUS_LABELS: Record<string, string> = {
  backlog: "BACKLOG",
  todo: "TODO",
  in_progress: "IN PROGRESS",
  in_review: "IN REVIEW",
  done: "DONE",
  cancelled: "CANCELLED",
};

// Ordered list of board columns (left → right).
export const STATUS_ORDER = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
] as const;

export const PRIORITY_ORDER = ["urgent", "high", "medium", "low", "none"] as const;

export const PRIORITY_LABELS: Record<string, string> = {
  urgent: "URGENT",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
  none: "NONE",
};

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
