import { useListActivity, useListProjects } from "@workspace/api-client-react";
import { useStore } from "../store/useStore";
import { useEffect } from "react";
import { format } from "date-fns";
import { Plus } from "lucide-react";
import { ViewSwitcher } from "../components/ViewSwitcher";
import { VIEW_COMPONENTS } from "../components/views/registry";
import { viewMeta } from "../lib/views";

export function Home() {
  const { currentView, activeProjectId, setActiveProjectId, setNewIssueOpen } = useStore();
  const { data: projects, isLoading: projectsLoading } = useListProjects();
  const { data: activity } = useListActivity();
  const ActiveView = VIEW_COMPONENTS[currentView];

  useEffect(() => {
    if (projects && projects.length > 0 && !activeProjectId) {
      setActiveProjectId(projects[0].id);
    }
  }, [projects, activeProjectId, setActiveProjectId]);

  return (
    <div className="flex h-full w-full">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-6 border-b border-border bg-card shrink-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-black uppercase tracking-tighter">DASHBOARD</h1>
              <ViewSwitcher />
            </div>
            <div className="flex items-center gap-3">
              {projects && projects.length > 0 && (
                <select
                  className="bg-background border border-border px-3 py-2 text-sm font-bold uppercase outline-none"
                  value={activeProjectId || ""}
                  onChange={(e) => setActiveProjectId(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
              <button
                onClick={() => setNewIssueOpen(true)}
                disabled={!activeProjectId}
                data-testid="new-issue-button"
                className="flex items-center gap-2 bg-primary text-primary-foreground border border-primary px-3 py-2 text-sm font-bold uppercase tracking-wider hover:bg-primary/90 disabled:opacity-40"
              >
                <Plus className="w-4 h-4" /> New Issue
              </button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{viewMeta(currentView).description}</p>
        </div>

        <div className="flex-1 overflow-auto p-6 relative">
          {projectsLoading ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-muted-foreground font-bold tracking-widest animate-pulse">LOADING…</div>
            </div>
          ) : !activeProjectId ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-muted-foreground font-bold tracking-widest">NO PROJECT SELECTED</div>
            </div>
          ) : (
            <ActiveView projectId={activeProjectId} />
          )}
        </div>
      </div>

      <aside className="w-80 border-l border-border bg-card shrink-0 flex flex-col">
        <div className="p-4 border-b border-border bg-muted/20 shrink-0">
          <h2 className="font-bold uppercase tracking-wider text-sm">ACTIVITY FEED</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {activity?.map((entry) => (
            <div key={entry.id} className="text-sm border-l-2 border-primary pl-3 py-1">
              <div className="text-muted-foreground text-xs mb-1 font-mono">
                {format(new Date(entry.timestamp), "MMM dd, HH:mm")}
              </div>
              <div className="font-bold mb-1">
                {entry.actor} {entry.action.replace(/_/g, " ")}
              </div>
              {entry.issueTitle && (
                <div className="text-muted-foreground truncate">{entry.issueTitle}</div>
              )}
            </div>
          ))}
          {!activity?.length && (
            <div className="text-muted-foreground text-xs text-center py-4">NO ACTIVITY YET</div>
          )}
        </div>
      </aside>
    </div>
  );
}
