import type { ReactNode } from "react";
import { LoadingState } from "./LoadingState";

/**
 * Shared wrapper for query render surfaces. Distinguishes the three states a
 * failed/loading fetch otherwise collapses into:
 *  - loading  → the brutalist LoadingState placeholder
 *  - error    → a compact role="alert" block with the message + a keyboard
 *               focusable Retry button (calls onRetry, typically TanStack
 *               `refetch`), so a transient failure is recoverable in-place and
 *               no longer indistinguishable from "no data".
 *  - settled  → renders children (empty-state handling stays per-call-site).
 *
 * Behaviour-preserving: when neither isLoading nor isError, it is a transparent
 * pass-through of children. Pass `skeleton` to show a content-shaped placeholder
 * (Skeletons.*) while loading instead of the plain "LOADING…" text.
 */
export function DataState({
  isLoading,
  isError,
  onRetry,
  error,
  loadingClassName,
  className = "h-full w-full",
  skeleton,
  children,
}: {
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  error?: unknown;
  /** Forwarded to LoadingState's layout wrapper. */
  loadingClassName?: string;
  /** Layout wrapper for the error block. */
  className?: string;
  /** Optional content-shaped loader shown while loading (e.g. <SkeletonRows />). */
  skeleton?: ReactNode;
  children: ReactNode;
}) {
  if (isLoading) return skeleton !== undefined ? <>{skeleton}</> : <LoadingState className={loadingClassName} />;

  if (isError) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "The request failed. Check your connection and try again.";
    return (
      <div className={`${className} flex items-center justify-center`.trim()}>
        <div
          role="alert"
          className="max-w-md w-full border border-red-500/40 bg-red-500/5 p-6 text-center space-y-3"
        >
          <div className="text-sm font-black uppercase tracking-widest text-red-500">
            Could not load
          </div>
          <p className="text-xs text-muted-foreground font-mono break-words">{message}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-2 border border-primary text-primary px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:bg-primary hover:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
