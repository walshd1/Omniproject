import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useLocation } from "wouter";
import { useQueries } from "@tanstack/react-query";
import { useListProjects, useListProgrammes, type Issue } from "@workspace/api-client-react";
import { getJson } from "../../lib/api";
import { useFeatures, featureEnabled } from "../../lib/features";
import { useGlobalSearch, searchEntities, type SearchHit } from "../../lib/global-search";
import { useSidePanel } from "../../lib/side-panel";

/**
 * Global search (the "globalSearch" feature module). A command-palette-style overlay that
 * quick-finds across projects, issues and programmes from the existing read-model. Keyboard-first
 * (↑/↓ to move, Enter to jump, Esc to close); selecting an issue routes to its project and opens
 * the rich side-panel when that module is enabled. Opened with "/" (outside inputs) or via the
 * header search button; rendered once at the app shell and gated by `useFeatures`.
 */

const TYPE_LABEL: Record<SearchHit["type"], string> = { project: "Project", issue: "Issue", programme: "Programme" };

export function GlobalSearch() {
  const { data: features } = useFeatures();
  const enabled = featureEnabled(features, "globalSearch");
  const sidePanelOn = featureEnabled(features, "sidePanel");
  const { open, setOpen } = useGlobalSearch();
  const openSidePanel = useSidePanel((s) => s.openIssue);
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  // "/" opens the overlay unless the user is typing in a field.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "/" && !typing && !open) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, open, setOpen]);

  const { data: projects } = useListProjects();
  const { data: programmes } = useListProgrammes();
  // Issues are fetched per project only while the overlay is open (cross-project quick-find).
  const issueQueries = useQueries({
    queries: (open ? projects ?? [] : []).map((p) => ({
      queryKey: ["global-search-issues", p.id] as const,
      queryFn: () => getJson<Issue[]>(`/api/projects/${p.id}/issues`),
      staleTime: 30_000,
    })),
  });

  const issues = useMemo(
    () => issueQueries.flatMap((q) => q.data ?? []).map((i) => ({ id: i.id, title: i.title, projectId: i.projectId })),
    [issueQueries],
  );

  const hits = useMemo(
    () => searchEntities(query, {
      projects: (projects ?? []).map((p) => ({ id: p.id, name: p.name })),
      programmes: (programmes ?? []).map((p) => ({ id: p.id, name: p.name })),
      issues,
    }),
    [query, projects, programmes, issues],
  );

  useEffect(() => setActive(0), [query]);

  function go(hit: SearchHit) {
    setOpen(false);
    setQuery("");
    if (hit.type === "project") setLocation(`/projects/${hit.id}`);
    else if (hit.type === "programme") setLocation(`/programmes/${hit.id}`);
    else if (hit.type === "issue" && hit.projectId) {
      setLocation(`/projects/${hit.projectId}`);
      if (sidePanelOn) openSidePanel(hit.projectId, hit.id);
    }
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && hits[active]) { e.preventDefault(); go(hits[active]!); }
  }

  if (!enabled) return null;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" />
        <Dialog.Content
          aria-label="Global search"
          aria-describedby={undefined}
          className="fixed left-1/2 top-32 z-50 w-full max-w-2xl -translate-x-1/2 bg-card border border-border shadow-2xl overflow-hidden focus:outline-none"
          data-testid="global-search"
        >
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <input
            autoFocus
            aria-label="Search projects, issues and programmes"
            placeholder="Search projects, issues, programmes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            className="w-full px-4 py-3 text-lg bg-transparent border-b border-border outline-none text-foreground placeholder:text-muted-foreground font-mono"
          />
          <ul className="max-h-[320px] overflow-y-auto p-2" data-testid="global-search-results">
            {query.trim() === "" ? (
              <li className="p-4 text-sm text-center text-muted-foreground">Type to search.</li>
            ) : hits.length === 0 ? (
              <li className="p-4 text-sm text-center text-muted-foreground" data-testid="global-search-empty">No matches.</li>
            ) : (
              hits.map((hit, i) => (
                <li key={`${hit.type}:${hit.id}`}>
                  <button
                    type="button"
                    onClick={() => go(hit)}
                    aria-selected={i === active}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${i === active ? "bg-foreground text-background" : "hover:bg-muted"}`}
                  >
                    <span className="truncate">{hit.label}</span>
                    <span className="shrink-0 text-xs font-black uppercase tracking-widest opacity-70">{TYPE_LABEL[hit.type]}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
