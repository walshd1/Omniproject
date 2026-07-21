import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { FlaskConical, ExternalLink, LogOut, Download, AlertTriangle } from "lucide-react";
import { ReplicaWorkbench } from "../../components/explore/ReplicaWorkbench";
import { CatalogueReport } from "../../components/reports/CatalogueReport";
import { TimeTravel } from "../../components/reports/TimeTravel";
import { loadSnapshots, exportSnapshots } from "../../lib/snapshots";
import { loadEdges, exportEdges } from "../../lib/dependencies";
import { isExplorationDirty, subscribeExploration } from "../../lib/exploration";
import { useAuth } from "../../lib/auth";
import { CommandPalette } from "../../components/CommandPalette";

/**
 * Exploration mode — a deliberately, obviously-different surface for snapshots,
 * what-if and dependency modelling, kept visually separate from the live app so a
 * modelled or historical figure can never be mistaken for production reality.
 * Everything here is volatile and in-browser (stateless): your work is held in
 * the session only, and you DOWNLOAD it to keep it or it is discarded when you
 * close the tab. A leave-warning fires if there is undownloaded work.
 */
export function Explore() {
  const [, setLocation] = useLocation();
  const [dirty, setDirty] = useState<boolean>(isExplorationDirty());
  // Explore is mounted OUTSIDE AppLayout (the app's only client auth guard), so it must guard
  // itself — otherwise an unauthenticated visitor gets the full Explore surface. Fail closed on
  // any auth error, same as AppLayout.
  const { data: auth, isLoading: authLoading, isError: authError } = useAuth();
  useEffect(() => {
    if (!authLoading && (authError || (auth && !auth.authenticated))) setLocation("/login");
  }, [auth, authLoading, authError, setLocation]);

  // Reflect the session's undownloaded-work state.
  useEffect(() => subscribeExploration(() => setDirty(isExplorationDirty())), []);

  // Warn before leaving/closing while there is undownloaded exploration work.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // triggers the browser's native "leave site?" prompt
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const downloadExploration = () => {
    const snaps = loadSnapshots();
    const edges = loadEdges();
    // Clear ONLY what we actually downloaded. exportSnapshots/exportEdges each clear their own source;
    // the replica-workbench overlay + schedule-shift what-ifs (not exported here) keep their warning, so
    // downloading snapshots can never silently drop unsaved replica work.
    if (snaps.length) exportSnapshots(snaps);
    if (edges.length) exportEdges(edges);
  };

  const popOut = () => {
    window.open(window.location.href, "omni-explore", "width=1280,height=900,noopener");
  };

  // Gate rendering until auth resolves; render nothing for an unauthenticated/errored state
  // (the effect above redirects to /login) so the surface never flashes for a logged-out visitor.
  if (authLoading) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background text-muted-foreground font-bold tracking-widest animate-pulse">
        AUTHENTICATING…
      </div>
    );
  }
  if (authError || (auth && !auth.authenticated)) return null;

  return (
    <div
      className="min-h-screen bg-blue-500/5 text-foreground"
      // Faint diagonal hazard wash so the surface reads as "the lab", not live —
      // visible even in a screenshot.
      style={{
        backgroundImage:
          "repeating-linear-gradient(45deg, transparent, transparent 22px, rgba(59,130,246,0.04) 22px, rgba(59,130,246,0.04) 44px)",
      }}
      data-testid="explore-mode"
    >
      {/* Hazard ribbon — always visible, unmistakable */}
      <div className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 border-b-2 border-blue-500/50 bg-blue-500/10 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
          <FlaskConical className="w-5 h-5" />
          <span className="text-sm font-black uppercase tracking-widest">Exploration</span>
          <span className="text-[11px] font-bold uppercase tracking-widest text-blue-600/70 dark:text-blue-400/70">
            · Snapshots &amp; What-If · NOT LIVE DATA
          </span>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <button
              type="button"
              onClick={downloadExploration}
              data-testid="explore-download"
              className="inline-flex items-center gap-2 border border-blue-500 bg-blue-500 text-white px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:bg-blue-500/90 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <Download className="w-4 h-4" /> Download exploration
            </button>
          )}
          <button
            type="button"
            onClick={popOut}
            data-testid="explore-popout"
            title="Open this exploration in its own window"
            className="inline-flex items-center gap-2 border border-border px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <ExternalLink className="w-4 h-4" /> Pop out
          </button>
          <button
            type="button"
            onClick={() => setLocation("/reports")}
            data-testid="explore-exit"
            className="inline-flex items-center gap-2 border border-border px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <LogOut className="w-4 h-4" /> Exit to live
          </button>
        </div>
      </div>

      {/* Undownloaded-work banner */}
      {dirty && (
        <div
          role="status"
          data-testid="explore-unsaved"
          className="flex flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-bold text-amber-600 dark:text-amber-400"
        >
          <AlertTriangle className="w-4 h-4" />
          Unsaved exploration — download to keep it, or it's discarded when you close this tab.
        </div>
      )}

      <div className="max-w-6xl mx-auto p-6 sm:p-8 space-y-10">
        <header>
          <h1 className="text-3xl font-black uppercase tracking-tighter">Exploration Sandbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Model freely — capture snapshots, run what-ifs, and link cross-system dependencies by hash. None of it touches a
            backend or the gateway; it lives in this browser session until you download it.
          </p>
        </header>

        <ReplicaWorkbench />
        <CatalogueReport id="portfolio-trends" />
        <TimeTravel />
        <CatalogueReport id="scenario-sandbox" />
        <CatalogueReport id="schedule-sandbox" />
        <CatalogueReport id="dependency-links" />
      </div>

      {/* Keyboard parity: the sandbox is mounted OUTSIDE AppLayout, so ⌘K would otherwise be a
          dead key here. Mounting the palette keeps "≤2 actions to get anywhere" true from the lab —
          it's a transient on-demand overlay (navigation aid), not persistent live chrome. */}
      <CommandPalette />
    </div>
  );
}
