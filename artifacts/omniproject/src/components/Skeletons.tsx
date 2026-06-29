import { Skeleton } from "@/components/ui/skeleton";
import { useReducedMotion } from "../lib/use-reduced-motion";

/**
 * Shared, content-shaped skeleton loaders so every surface shows the same calm placeholder while
 * data arrives (instead of an ad-hoc "LOADING…" everywhere). Under reduced motion the shimmer is
 * dropped (static blocks) — belt-and-braces with the CSS that already collapses animation duration.
 *
 * `data-testid="skeleton"` + `aria-hidden` (these are decorative; the live region announces state).
 */

function useBlockClass(): (extra: string) => string {
  const reduced = useReducedMotion();
  return (extra: string) => `${reduced ? "" : "animate-pulse "}bg-primary/10 rounded-md ${extra}`.trim();
}

/** A few lines of placeholder text (e.g. a paragraph / description). */
export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  const block = useBlockClass();
  return (
    <div className={`space-y-2 ${className}`.trim()} data-testid="skeleton" aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={block(`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`)} />
      ))}
    </div>
  );
}

/** A list/table of rows (e.g. the grid or a list view while loading). */
export function SkeletonRows({ rows = 6, className = "" }: { rows?: number; className?: string }) {
  const block = useBlockClass();
  return (
    <div className={`space-y-2 ${className}`.trim()} data-testid="skeleton" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={block("h-8 w-full")} />
      ))}
    </div>
  );
}

/** A grid of cards (e.g. the projects / dashboard widgets while loading). */
export function SkeletonCards({ count = 6, className = "" }: { count?: number; className?: string }) {
  const block = useBlockClass();
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 ${className}`.trim()} data-testid="skeleton" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border-2 border-border p-4 space-y-3">
          <div className={block("h-4 w-2/3")} />
          <div className={block("h-3 w-full")} />
          <div className={block("h-3 w-1/2")} />
        </div>
      ))}
    </div>
  );
}

// Re-export the base block for callers that need a one-off shape.
export { Skeleton };
