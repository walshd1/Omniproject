import type { ReactNode } from "react";

/**
 * A KPI tile primitive — a single labelled figure with an optional hint, data-agnostic like the chart
 * primitives. `tone` colours the value for genuine state (good / warning / critical), never as a
 * categorical accent. This is the shared substrate the report stat tiles render through.
 */
export type TileTone = "default" | "good" | "warn" | "bad";

const TONE_CLASS: Record<TileTone, string> = {
  default: "",
  good: "text-green-500",
  warn: "text-amber-500",
  bad: "text-red-500",
};

export function StatTile({ label, value, hint, tone = "default", align = "center" }: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: TileTone;
  align?: "center" | "left";
}) {
  return (
    <div className={`border border-border bg-background p-3 ${align === "center" ? "text-center" : "text-left"}`}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-2xl font-black font-mono tabular-nums ${TONE_CLASS[tone]}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
