import type { ReactNode } from "react";

/**
 * A status pill primitive — a small labelled chip whose `tone` colours it for genuine state
 * (good / warning / critical / info), reserved status colours, never a categorical accent. The
 * shared substrate for the "flag/RAG chip" spans scattered across the report panels.
 */
export type BadgeTone = "neutral" | "good" | "warn" | "bad" | "info";

// WCAG 1.4.3: the tone TEXT sits over a faint /15 tint (≈ the page background), so it must meet AA as
// text on that background. The 600/500 shades fail on the LIGHT theme (~2.9–3.4:1); use the 700 shade on
// light (≥4.48:1) and a 400 shade on dark (≥6.8:1), where the darker shade would be too low.
const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  good: "bg-green-500/15 text-green-700 dark:text-green-400",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  bad: "bg-red-500/15 text-red-700 dark:text-red-400",
  info: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
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
