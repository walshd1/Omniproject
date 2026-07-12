import type { ReactNode } from "react";

/**
 * A status pill primitive — a small labelled chip whose `tone` colours it for genuine state
 * (good / warning / critical / info), reserved status colours, never a categorical accent. The
 * shared substrate for the "flag/RAG chip" spans scattered across the report panels.
 */
export type BadgeTone = "neutral" | "good" | "warn" | "bad" | "info";

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  good: "bg-green-500/15 text-green-600",
  warn: "bg-amber-500/15 text-amber-600",
  bad: "bg-red-500/15 text-red-500",
  info: "bg-sky-500/15 text-sky-600",
};

export function Badge({ tone = "neutral", className = "", title, testId, children }: {
  tone?: BadgeTone;
  className?: string;
  title?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`px-1.5 py-0.5 text-[10px] font-black rounded-sm ${TONE_CLASS[tone]} ${className}`.trim()}
      {...(title ? { title } : {})}
      {...(testId ? { "data-testid": testId } : {})}
    >
      {children}
    </span>
  );
}
