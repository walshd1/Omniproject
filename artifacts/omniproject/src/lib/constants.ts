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
