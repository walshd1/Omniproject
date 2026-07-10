import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The shared "no data yet" panel every report re-inlined byte-for-byte: a dashed brutalist card
 * with muted, centred text. Reports pass only their own message and the `X-empty` test id; the
 * dashed border, card background, padding and centring live here, so restyling the empty state is
 * one edit instead of the same tweak across two dozen report files.
 */
export function ReportEmpty({
  testId,
  className,
  children,
}: {
  /** `data-testid` on the card (kept as each report's existing `X-empty` id). */
  testId?: string;
  /** Optional extra classes for the rare non-standard case. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("bg-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground", className)}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
