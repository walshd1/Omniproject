import type { Issue } from "@workspace/api-client-react";

/**
 * Methodology helpers. OmniProject's data model (status, priority, labels,
 * dates) is methodology-neutral; each view derives its concepts (sprints, story
 * points, stages, WIP, RAG) from that data. n8n can populate richer fields
 * later (e.g. real sprint/stage labels) and these helpers will pick them up.
 */

const POINTS_BY_PRIORITY: Record<string, number> = { urgent: 8, high: 5, medium: 3, low: 2, none: 1 };

export const isDone = (s: string) => s === "done";
export const isTerminal = (s: string) => s === "done" || s === "cancelled";

export function isOverdue(issue: Issue): boolean {
  return !!issue.dueDate && new Date(issue.dueDate) < new Date() && !isTerminal(issue.status);
}

/** Story points from an `sp:N` / `points:N` label, else weighted by priority. */
export function storyPoints(issue: Issue): number {
  const lbl = issue.labels.find((l) => /^(sp|pts?|points?)[:\-]?\s*\d+$/i.test(l));
  const m = lbl?.match(/(\d+)/);
  if (m) return Number(m[1]);
  return POINTS_BY_PRIORITY[issue.priority] ?? 1;
}

/** Explicit `sprint:<name>` / `iteration:<name>` label, if any. */
export function explicitSprint(issue: Issue): string | null {
  const l = issue.labels.find((x) => /^(sprint|iteration)[\s:_-]/i.test(x));
  return l ? l.replace(/^(sprint|iteration)[\s:_-]+/i, "").trim() : null;
}

/** Explicit `stage:<name>` label, if any. */
export function explicitStage(issue: Issue): string | null {
  const l = issue.labels.find((x) => /^stage[\s:_-]/i.test(x));
  return l ? l.replace(/^stage[\s:_-]+/i, "").trim() : null;
}

// ── Scrum ─────────────────────────────────────────────────────────────────────
// Active-sprint membership: an explicit sprint label, else committed work
// (anything past backlog and not terminal — i.e. todo/in_progress/in_review).
export function inActiveSprint(issue: Issue): boolean {
  if (explicitSprint(issue)) return true;
  return issue.status === "todo" || issue.status === "in_progress" || issue.status === "in_review";
}

// Sprint board columns (To Do → Done).
export const SPRINT_COLUMNS = ["todo", "in_progress", "in_review", "done"] as const;

// ── Kanban / Lean WIP limits (per status) ─────────────────────────────────────
export const WIP_LIMITS: Record<string, number> = { in_progress: 4, in_review: 3 };

// ── PRINCE2 management stages ─────────────────────────────────────────────────
export const PRINCE2_STAGES = ["Initiation", "Delivery", "Closure"] as const;

/** PRINCE2 management stage from an explicit `stage:` label, else from status. */
export function prince2Stage(issue: Issue): string {
  const e = explicitStage(issue);
  if (e) return e;
  switch (issue.status) {
    case "backlog":
    case "todo":
      return "Initiation";
    case "in_progress":
    case "in_review":
      return "Delivery";
    default:
      return "Closure";
  }
}

// ── RAG rollup ────────────────────────────────────────────────────────────────
export type Rag = "GREEN" | "AMBER" | "RED";

export function ragFor(completionPct: number, overdueCount: number): Rag {
  if (overdueCount >= 3 || completionPct < 25) return "RED";
  if (overdueCount > 0 || completionPct < 60) return "AMBER";
  return "GREEN";
}

export const RAG_DOT: Record<Rag, string> = { GREEN: "bg-green-500", AMBER: "bg-amber-500", RED: "bg-red-500" };
export const RAG_TEXT: Record<Rag, string> = { GREEN: "text-green-500", AMBER: "text-amber-500", RED: "text-red-500" };

export function completion(issues: Issue[]): number {
  if (issues.length === 0) return 0;
  return Math.round((issues.filter((i) => isDone(i.status)).length / issues.length) * 100);
}
