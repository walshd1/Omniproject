import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { CircleDot, ExternalLink } from "lucide-react";
import { useAuth } from "../lib/auth";
import { usePortalStatus } from "../lib/portal";

/**
 * Portal — the client-facing, read-only project status page (roadmap 2.2). Rendered BARE (no AppLayout nav
 * shell), like /explore, because a guest must never see the app chrome. It shows only the curated status the
 * gateway returns for the guest's one project (progress, RAG rollup, dated milestones) — no portfolio, no
 * financials, nothing to operate. A non-guest (or a signed-out visitor) sees a friendly "unavailable" notice
 * instead of app data.
 */
const STATUS_LABEL: Record<string, string> = { red: "At risk", amber: "Needs attention", green: "On track" };

export function Portal() {
  const { data: auth } = useAuth();
  const [, setLocation] = useLocation();
  const statusQ = usePortalStatus();
  const status = statusQ.data;

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="portal-page">
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        <header className="flex flex-wrap items-center gap-2 border-b border-border pb-4">
          <CircleDot className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-black uppercase tracking-widest flex-1 min-w-0">
            {status ? status.project.name : "Project portal"}
          </h1>
          {auth?.authenticated && (
            <Button type="button" variant="ghost" size="sm" data-testid="portal-signout" onClick={() => setLocation("/login")}>
              Sign out
            </Button>
          )}
        </header>

        {statusQ.isLoading ? (
          <p className="text-sm text-muted-foreground animate-pulse" data-testid="portal-loading">Loading your project…</p>
        ) : statusQ.isError || !status ? (
          <div className="rounded border border-border p-4 space-y-2" data-testid="portal-unavailable">
            <p className="text-sm font-bold">This portal isn't available for your account.</p>
            <p className="text-sm text-muted-foreground">
              Client portals open from a personal invite link. If you were sent one, use it to sign in; if you
              manage this project, invite a client from the project page.
            </p>
          </div>
        ) : (
          <article className="space-y-6" data-testid="portal-status">
            {status.project.description && (
              <p className="text-sm text-muted-foreground">{status.project.description}</p>
            )}

            {/* Progress */}
            <section className="space-y-1">
              <div className="flex items-center justify-between text-xs uppercase tracking-widest text-muted-foreground">
                <span>Progress</span>
                <span data-testid="portal-percent">{status.progress.percent}%</span>
              </div>
              <div className="h-3 w-full rounded bg-muted overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, status.progress.percent))}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">{status.progress.done} of {status.progress.total} items complete</p>
            </section>

            {/* Health rollup */}
            <section className="flex flex-wrap gap-2" data-testid="portal-health">
              {(["green", "amber", "red"] as const).map((k) => (
                <span key={k} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs">
                  <span className={`h-2 w-2 rounded-full ${k === "red" ? "bg-red-500" : k === "amber" ? "bg-amber-500" : "bg-green-500"}`} />
                  {STATUS_LABEL[k]}: <span className="font-bold">{status.health[k]}</span>
                </span>
              ))}
            </section>

            {/* Milestones */}
            <section className="space-y-2">
              <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Milestones</h2>
              {status.milestones.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="portal-no-milestones">No dated milestones yet.</p>
              ) : (
                <ul className="space-y-1" data-testid="portal-milestones">
                  {status.milestones.map((m, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 border border-border rounded p-2 text-sm">
                      <span className="flex-1 min-w-0">{m.title}</span>
                      <span className="text-xs uppercase tracking-wider text-muted-foreground">{m.status}</span>
                      <span className="text-xs font-mono text-muted-foreground">{m.dueDate}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <footer className="border-t border-border pt-3 text-xs text-muted-foreground flex items-center gap-1">
              <ExternalLink className="h-3 w-3" /> Read-only status shared with you. Contact your project manager for changes.
            </footer>
          </article>
        )}
      </div>
    </div>
  );
}
