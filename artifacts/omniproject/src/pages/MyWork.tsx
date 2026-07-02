import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueries } from "@tanstack/react-query";
import { useListProjects, type Issue, type Project } from "@workspace/api-client-react";
import { getJson } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useFeatures, featureEnabled } from "../lib/features";
import { useLiveEvents, type LiveEvent } from "../lib/live-events";
import { STATUS_ORDER, statusLabel } from "../lib/constants";
import { createConcurrencyLimiter } from "../lib/concurrency-pool";
import { DataState } from "../components/DataState";

/**
 * My Work / Inbox (the "myWork" feature module). Two tabs:
 *  - **My Work** — items assigned to the current user across every project, grouped by status.
 *    Reads through the existing read-model (projects → per-project issues); no new write surface.
 *  - **Inbox** — the user's live notifications from the existing SSE stream (lib/live-events).
 *    Mark-as-read is client-side/ephemeral for v1; gracefully empty when nothing's wired.
 */

// Bounds actual in-flight "my work" issue fetches (there's one useQueries entry per project, up to
// 200-wide at the target scale, which would otherwise saturate the browser's per-origin connection
// limit on every tab open). See docs/PERF-PATTERNS-REVIEW.md, Theme A.
const issuesFetchPool = createConcurrencyLimiter(8);

/** Is this issue assigned to me? Matches the assignee against the session sub / email / name. */
export function isAssignedToMe(assignee: string | null | undefined, me: { sub?: string | undefined; email?: string | undefined; name?: string | undefined }): boolean {
  const a = (assignee ?? "").trim().toLowerCase();
  if (!a) return false;
  return [me.sub, me.email, me.name].some((v) => v && v.toLowerCase() === a);
}

export function MyWork() {
  const { data: features } = useFeatures();
  const enabled = featureEnabled(features, "myWork");
  const { data: auth } = useAuth();
  const { data: projects, isLoading, isError, error, refetch } = useListProjects();
  const [tab, setTab] = useState<"work" | "inbox">("work");

  // One issues query per project; cross-project assigned items are filtered client-side. Actual
  // fetch starts are bounded by issuesFetchPool (Theme A); `combine` folds the per-project results
  // into one array whose REFERENCE only changes when the underlying data actually changes — so the
  // `mine` useMemo below doesn't re-run its O(projects) scan on every unrelated re-render (tab
  // switch, sibling state, live event) the way a fresh useQueries() array would force (Theme C).
  const issuesByProject = useQueries({
    queries: (projects ?? []).map((p) => ({
      queryKey: ["my-work-issues", p.id] as const,
      queryFn: () => issuesFetchPool(() => getJson<Issue[]>(`/api/projects/${p.id}/issues`)),
      staleTime: 30_000,
    })),
    combine: (results) => results.map((r) => r.data as Issue[] | undefined),
  });

  const sub = auth?.user?.sub;
  const email = auth?.user?.email;
  const name = auth?.user?.name;
  const mine = useMemo(() => {
    const me = { sub, email, name };
    const out: { project: Project; issue: Issue }[] = [];
    (projects ?? []).forEach((p, i) => {
      for (const issue of issuesByProject[i] ?? []) {
        if (isAssignedToMe(issue.assignee, me)) out.push({ project: p, issue });
      }
    });
    return out;
  }, [projects, issuesByProject, sub, email, name]);

  const grouped = useMemo(() => {
    const order = (s: string) => { const i = STATUS_ORDER.indexOf(s as (typeof STATUS_ORDER)[number]); return i < 0 ? 999 : i; };
    const byStatus = new Map<string, { project: Project; issue: Issue }[]>();
    for (const row of mine) {
      const arr = byStatus.get(row.issue.status) ?? [];
      arr.push(row);
      byStatus.set(row.issue.status, arr);
    }
    return [...byStatus.entries()].sort((a, b) => order(a[0]) - order(b[0]));
  }, [mine]);

  // Inbox: accumulate live notifications (newest first), client-side dismiss.
  const [inbox, setInbox] = useState<LiveEvent[]>([]);
  useLiveEvents((e) => setInbox((prev) => [e, ...prev].slice(0, 100)));
  const dismiss = (idx: number) => setInbox((prev) => prev.filter((_, i) => i !== idx));

  if (!enabled) {
    return <div className="p-8 text-sm text-muted-foreground">The “My Work” module is not enabled.</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-8 py-4 border-b border-border bg-card shrink-0 flex items-center gap-3">
        <h1 className="text-xl font-black uppercase tracking-tighter">My Work</h1>
        <div className="ml-auto inline-flex border-2 border-foreground" role="tablist" aria-label="My Work view">
          {(["work", "inbox"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs font-bold uppercase tracking-wider ${tab === t ? "bg-foreground text-background" : ""}`}
            >
              {t === "work" ? "Assigned to me" : `Inbox${inbox.length ? ` (${inbox.length})` : ""}`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 p-8 overflow-auto">
        {tab === "work" ? (
          <DataState isLoading={isLoading} isError={isError} error={error} onRetry={refetch}>
            {mine.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="my-work-empty">Nothing is assigned to you right now.</p>
            ) : (
              <div className="space-y-6" data-testid="my-work-list">
                {grouped.map(([status, rows]) => (
                  <section key={status}>
                    <h2 className="mb-2 text-xs font-black uppercase tracking-widest text-muted-foreground">{statusLabel(status)} · {rows.length}</h2>
                    <ul className="divide-y divide-border border-2 border-foreground">
                      {rows.map(({ project, issue }) => (
                        <li key={`${project.id}:${issue.id}`} className="flex items-center justify-between gap-4 p-3 text-sm">
                          <span className="font-medium">{issue.title}</span>
                          <Link href={`/projects/${project.id}`} className="text-xs font-mono text-primary hover:underline">{project.name}</Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </DataState>
        ) : (
          <div data-testid="inbox">
            {inbox.length === 0 ? (
              <p className="text-sm text-muted-foreground">No notifications yet. New events appear here live.</p>
            ) : (
              <ul className="divide-y divide-border border-2 border-foreground">
                {inbox.map((n, i) => (
                  <li key={i} className="flex items-start justify-between gap-4 p-3 text-sm">
                    <div>
                      <span className="font-bold">{String(n.kind ?? "notification")}</span>
                      <span className="ml-2 text-muted-foreground">{String((n as Record<string, unknown>)["message"] ?? (n as Record<string, unknown>)["title"] ?? "")}</span>
                    </div>
                    <button onClick={() => dismiss(i)} aria-label="Dismiss" className="text-xs font-bold uppercase text-muted-foreground hover:text-foreground">Dismiss</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
