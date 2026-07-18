import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import type { Panel } from "../../lib/screen";
import { useLiveEvents, matchesLive } from "../../lib/live-events";
import { resolveSourceUrl } from "../../lib/panel-source";
import { useStore } from "../../store/useStore";

/**
 * Per-panel data binding — gives a panel its OWN query so it loads, revalidates and
 * REFRESHES independently of the rest of the screen, composing the primitives:
 *
 *  - own query key `["panel-data", url]` ⇒ refresh = refetch just this panel
 *    (button, or `invalidateQueries`); siblings are untouched.
 *  - conditional reads (ETag / broker change token) ⇒ an unchanged refresh is a
 *    cheap 304 and nothing re-renders.
 *  - PROGRESSIVE: shows a skeleton on first load instead of blocking on the slowest
 *    panel — the screen paints panel-by-panel.
 *  - LIVE (opt-in `source.live`): subscribes to the shared notification stream and
 *    revalidates ONLY itself when a relevant event arrives — push, not polling.
 *
 * The fetched object is merged into the panel's `config`.
 */
export function BoundPanel({ panel, render }: { panel: Panel; render: (p: Panel) => ReactNode }) {
  const source = panel.source!;
  // Fill `{projectId}` (and future context tokens) from the active project, so a JSON panel can bind a
  // project-scoped endpoint with no bespoke component. If a token is unresolved (no active project yet), hold
  // off fetching rather than hit a malformed URL.
  const activeProjectId = useStore((s) => s.activeProjectId);
  const { url, unresolved } = resolveSourceUrl(source.url, { projectId: activeProjectId ?? undefined });
  const qc = useQueryClient();
  const queryKey = ["panel-data", url] as const;

  const { data, isLoading, isFetching, isError, refetch } = useQuery<Record<string, unknown>>({
    queryKey,
    queryFn: async () => (await fetch(url, { credentials: "same-origin" })).json(),
    staleTime: 30_000,
    enabled: !unresolved,
  });

  if (unresolved) {
    return (
      <div className="rounded border border-border p-4" data-testid={`bound-panel-pending-${panel.id}`}>
        <p className="text-sm text-muted-foreground">Select a project to load {panel.title ?? "this panel"}.</p>
      </div>
    );
  }

  // Live, push-based revalidation: when a relevant change is announced, revalidate
  // THIS panel only (conditionally). The hook is a no-op when not opted in.
  useLiveEvents((event) => {
    if (source.live && matchesLive(event, source.liveOn)) {
      void qc.invalidateQueries({ queryKey });
    }
  });

  const merged: Panel = { ...panel, config: { ...(panel.config ?? {}), ...(data ?? {}) } };

  return (
    <div className="relative" data-testid={`bound-panel-${panel.id}`}>
      <button
        type="button"
        onClick={() => void refetch()}
        disabled={isFetching}
        aria-label={`Refresh ${panel.title ?? panel.id}`}
        data-testid={`panel-refresh-${panel.id}`}
        className="absolute right-2 top-2 z-10 rounded border border-border bg-background/70 px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        {isFetching ? "…" : "↻"}
      </button>
      {source.live && (
        <span className="absolute right-9 top-2 z-10 text-[9px] uppercase tracking-widest text-emerald-600/70" data-testid={`panel-live-${panel.id}`}>live</span>
      )}
      {isError && (
        <p className="absolute left-2 top-2 z-10 text-xs text-destructive" role="alert" data-testid={`panel-error-${panel.id}`}>
          failed to load
        </p>
      )}
      {isLoading ? (
        <div className="space-y-2 rounded border border-border p-4" data-testid={`panel-skeleton-${panel.id}`}>
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        render(merged)
      )}
    </div>
  );
}
