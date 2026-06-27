import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Panel } from "../../lib/screen";

/**
 * Per-panel data binding — gives a panel its OWN query so it loads, revalidates and
 * REFRESHES independently of the rest of the screen. "Refresh just this graph"
 * becomes refetching one query key; because the source endpoints support conditional
 * reads (ETag / broker change token), an unchanged refresh returns 304 and nothing
 * re-renders. The fetched object is merged into the panel's `config`.
 *
 * The query key is `["panel-data", url]`, so a refresh — by the panel's own button
 * or programmatically via `queryClient.invalidateQueries({ queryKey: ["panel-data",
 * url] })` — touches only this panel and never the others.
 */
export function BoundPanel({ panel, render }: { panel: Panel; render: (p: Panel) => ReactNode }) {
  const url = panel.source!.url;
  const { data, isFetching, isError, refetch } = useQuery<Record<string, unknown>>({
    queryKey: ["panel-data", url],
    queryFn: async () => (await fetch(url, { credentials: "same-origin" })).json(),
    staleTime: 30_000,
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
      {isError && (
        <p className="absolute left-2 top-2 z-10 text-xs text-destructive" role="alert" data-testid={`panel-error-${panel.id}`}>
          failed to load
        </p>
      )}
      {render(merged)}
    </div>
  );
}
