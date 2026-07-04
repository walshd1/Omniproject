import { useListActivity, useListProjects, useGetCapabilities } from "@workspace/api-client-react";
import { DataProvenance } from "../components/DataProvenance";
import { PROJECT_FIELDS } from "../lib/constants";
import { useStore } from "../store/useStore";
import { useEffect } from "react";
import { format } from "date-fns";
import { Plus, PlugZap } from "lucide-react";
import { Link } from "wouter";
import { ViewSwitcher } from "../components/ViewSwitcher";
import { VIEW_COMPONENTS } from "../components/views/registry";
import { viewMeta } from "../lib/views";
import { LoadingState } from "../components/LoadingState";
import { DataState } from "../components/DataState";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function Home() {
  const { currentView, activeProjectId, setActiveProjectId, setNewIssueOpen } = useStore();
  const { data: projects, isLoading: projectsLoading, isError: projectsError, error: projectsErr, refetch: refetchProjects, dataUpdatedAt } = useListProjects();
  const { data: activity } = useListActivity();
  const { data: caps } = useGetCapabilities();
  const ActiveView = VIEW_COMPONENTS[currentView];

  useEffect(() => {
    if (!projects || projects.length === 0) return;
    // Fall back to the first project when none is active, OR when the persisted
    // active id no longer exists in the current project list (e.g. it was
    // deleted, or belongs to another backend since the last session).
    const valid = activeProjectId && projects.some((p) => p.id === activeProjectId);
    if (!valid) {
      setActiveProjectId(projects[0]!.id); // length > 0 checked above
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
                <DataProvenance rows={projects as unknown as Record<string, unknown>[]} fields={PROJECT_FIELDS} mode={caps?.mode}
                  filename="dashboard-projects" fieldSources={caps?.fieldSources} polledAt={dataUpdatedAt} />
              )}
              {projects && projects.length > 0 && (
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <span>Active project:</span>
                  <Select value={activeProjectId || ""} onValueChange={(v) => setActiveProjectId(v)}>
                    <SelectTrigger
                      aria-label="Active project"
                      title="The active project governs the global New Issue action and the Cmd+K palette target."
                      className="w-auto rounded-none bg-background border-border px-3 py-2 text-sm font-bold uppercase text-foreground gap-2"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-none border-border font-bold uppercase">
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              )}
              <Button
                onClick={() => setNewIssueOpen(true)}
                disabled={!activeProjectId}
                data-testid="new-issue-button"
                className="rounded-none border border-primary px-3 py-2 text-sm font-bold uppercase tracking-wider"
              >
                <Plus className="w-4 h-4" /> New Issue
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{viewMeta(currentView).description}</p>
        </div>

        <div className="flex-1 overflow-auto p-6 relative">
          {projectsError ? (
            <DataState isError error={projectsErr} onRetry={() => refetchProjects()}>{null}</DataState>
          ) : projectsLoading ? (
            <div className="w-full h-full flex items-center justify-center">
              <LoadingState className="" />
            </div>
          ) : !activeProjectId ? (
            <div className="w-full h-full flex items-center justify-center">
              {projects && projects.length > 0 ? (
                <Empty className="border-2 border-border bg-card max-w-md">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Plus />
                    </EmptyMedia>
                    <EmptyTitle>Pick a project to get started</EmptyTitle>
                    <EmptyDescription>
                      Choose an active project above, then create your first issue.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <button
                      onClick={() => projects[0] && setActiveProjectId(projects[0].id)}
                      className="inline-flex items-center gap-2 bg-primary text-primary-foreground border border-primary px-4 py-2 text-sm font-bold uppercase tracking-wider hover:bg-primary/90"
                    >
                      Open {projects[0]?.name}
                    </button>
                  </EmptyContent>
                </Empty>
              ) : (
                <Empty className="border-2 border-border bg-card max-w-md">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <PlugZap />
                    </EmptyMedia>
                    <EmptyTitle>No projects yet</EmptyTitle>
                    <EmptyDescription>
                      Connect your backend in the Configurator to start tracking work. You'll be able to create your first issue once a project is available.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Link
                      href="/configurator"
                      className="inline-flex items-center gap-2 bg-primary text-primary-foreground border border-primary px-4 py-2 text-sm font-bold uppercase tracking-wider hover:bg-primary/90"
                    >
                      <PlugZap className="w-4 h-4" /> Go to Configurator
                    </Link>
                  </EmptyContent>
                </Empty>
              )}
            </div>
          ) : (
            <ActiveView projectId={activeProjectId} />
          )}
        </div>
      </div>

      <aside className="hidden lg:flex w-80 border-l border-border bg-card shrink-0 flex-col">
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
