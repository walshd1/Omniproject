import { useEffect, useState } from "react";
import { useListProjects } from "@workspace/api-client-react";
import { getComponent } from "@workspace/backend-catalogue";
import { useStore } from "../store/useStore";
import { useFeatures, featureEnabled } from "../lib/features";
import { useContentPages } from "../lib/content-pages";
import { LibraryComponentView } from "../components/library/LibraryComponentView";
import { DataState } from "../components/DataState";

/**
 * Content pages (the "content pages" feature module) — the public rendering surface for
 * settings.contentPages, authored via ContentPagesAdmin. A content page is a flat, ordered list of
 * unified-library component ids; this page just resolves and renders each one in order through
 * LibraryComponentView, which also drives each component's own declared `refresh` cadence. An optional
 * project selector (mirroring the Reports page) is threaded to every rendered component so a
 * project-scoped report (e.g. the EVM chart) placed on a content page has a project to read;
 * portfolio-scoped reports and widgets simply ignore it.
 */
export function ContentPages() {
  const { data: features } = useFeatures();
  const enabled = featureEnabled(features, "contentPages");
  const { data: pages, isLoading, isError, error, refetch } = useContentPages();
  const { data: projects } = useListProjects();
  const { activeProjectId, setActiveProjectId } = useStore();
  const [projectId, setProjectId] = useState(activeProjectId || "");
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId && projects && projects.length > 0) {
      setProjectId(activeProjectId || projects[0]!.id); // length > 0 checked above
    }
  }, [projects, projectId, activeProjectId]);

  const list = pages ?? [];
  const active = list.find((p) => p.id === activeId) ?? list[0] ?? null;

  const onSelectProject = (id: string) => {
    setProjectId(id);
    setActiveProjectId(id);
  };

  if (!enabled) {
    return <div className="p-8 text-sm text-muted-foreground">The “Content pages” module is not enabled.</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-8 py-4 border-b border-border bg-card shrink-0 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-black uppercase tracking-tighter">Content</h1>
        <select
          aria-label="Select content page"
          className="border-2 border-foreground bg-background px-2 py-1 text-sm font-bold"
          value={active?.id ?? ""}
          onChange={(e) => setActiveId(e.target.value)}
        >
          {list.length === 0 && <option value="">No content pages yet</option>}
          {list.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {projects && projects.length > 0 && (
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Project
            <select
              aria-label="Content page project"
              className="border-2 border-foreground bg-background px-2 py-1 text-sm font-bold"
              value={projectId}
              onChange={(e) => onSelectProject(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex-1 p-8 overflow-auto">
        <DataState isLoading={isLoading} isError={isError} error={error} onRetry={refetch}>
          {!active ? (
            <p className="text-sm text-muted-foreground" data-testid="content-pages-empty">
              No content pages yet. A PMO can build one from the unified component library under Settings → Content pages.
            </p>
          ) : active.componentIds.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="content-page-empty">
              “{active.name}” has no components yet.
            </p>
          ) : (
            <div className="max-w-5xl mx-auto space-y-8" data-testid="content-page-grid">
              {active.componentIds.map((id) => {
                const component = getComponent(id);
                if (!component) {
                  return (
                    <div key={id} className="bg-card border-2 border-dashed border-muted-foreground/40 p-4 text-sm text-muted-foreground" data-testid={`content-page-unknown-${id}`}>
                      Unknown component “{id}”. It may have been removed in a newer version.
                    </div>
                  );
                }
                return (
                  <section key={id}>
                    <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-3">{component.label}</h2>
                    <LibraryComponentView component={component} projectId={projectId} />
                  </section>
                );
              })}
            </div>
          )}
        </DataState>
      </div>
    </div>
  );
}
