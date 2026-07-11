import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useLocation } from "wouter";
import { useQueries } from "@tanstack/react-query";
import { useListProjects, useListProgrammes, type Issue } from "@workspace/api-client-react";
import { getJson } from "../../lib/api";
import { useFeatures, featureEnabled } from "../../lib/features";
import { useGlobalSearch, searchEntities, type SearchHit } from "../../lib/global-search";
import { useRecentItems } from "../../lib/recent-items";
import { useSidePanel } from "../../lib/side-panel";
import { createConcurrencyLimiter } from "../../lib/concurrency-pool";

/**
 * Global search (the "globalSearch" feature module). A command-palette-style overlay that
 * quick-finds across projects, issues and programmes from the existing read-model. Keyboard-first
 * (↑/↓ to move, Enter to jump, Esc to close); selecting an issue routes to its project and opens
 * the rich side-panel when that module is enabled. With no query yet, it offers the user's
 * recently-visited items (lib/recent-items) as a one-keystroke way back. Opened with "/" (outside
 * inputs) or via the header search button; rendered once at the app shell and gated by `useFeatures`.
 */

const TYPE_LABEL: Record<SearchHit["type"], string> = { project: "Project", issue: "Issue", programme: "Programme" };

// Combobox/listbox wiring: the input owns the listbox and points aria-activedescendant at the
// active option, each of which carries a stable id derived from its index in the on-screen list.
const LISTBOX_ID = "global-search-listbox";
const optionId = (i: number) => `search-opt-${i}`;

// Bounds actual in-flight issue fetches when the overlay opens (one useQueries entry per project,
// up to 200-wide at the target scale). See docs/PERF-PATTERNS-REVIEW.md, Theme A.
const issuesFetchPool = createConcurrencyLimiter(8);

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
  // Actual fetch starts are bounded by issuesFetchPool (Theme A); `combine` keeps the flattened
  // result referentially stable across renders that don't change the underlying query data — e.g.
  // every keystroke — instead of re-materializing the whole cross-project array each time (Theme C).
  const issues = useQueries({
    queries: (open ? projects ?? [] : []).map((p) => ({
      queryKey: ["global-search-issues", p.id] as const,
      queryFn: () => issuesFetchPool(() => getJson<Issue[]>(`/api/projects/${encodeURIComponent(p.id)}/issues`)),
      staleTime: 30_000,
    })),
    combine: (results) =>
      results.flatMap((r) => (r.data as Issue[] | undefined) ?? []).map((i) => ({ id: i.id, title: i.title, projectId: i.projectId })),
  });

  const hits = useMemo(
    () => searchEntities(query, {
      projects: (projects ?? []).map((p) => ({ id: p.id, name: p.name })),
      programmes: (programmes ?? []).map((p) => ({ id: p.id, name: p.name })),
      issues,
    }),
    [query, projects, programmes, issues],
  );

  // With no query, offer the user's recently-visited items as a quick way back (findability).
  const recents = useRecentItems((s) => s.items);
  const isEmptyQuery = query.trim() === "";
  // The keyboard/selection list is whatever is on screen: recents when idle, live hits when typing.
  const list = isEmptyQuery ? recents : hits;

  useEffect(() => setActive(0), [query]);

  // Keep the active option visible as arrow-key navigation moves it past the scroll viewport.
  useEffect(() => {
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
  }, [active]);

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
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, list.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && list[active]) { e.preventDefault(); go(list[active]!); }
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
            role="combobox"
            aria-label="Search projects, issues and programmes"
            aria-expanded={list.length > 0}
            aria-controls={LISTBOX_ID}
            aria-activedescendant={list[active] ? optionId(active) : undefined}
            placeholder="Search projects, issues, programmes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            className="w-full px-4 py-3 text-lg bg-transparent border-b border-border outline-none text-foreground placeholder:text-muted-foreground font-mono"
          />
          <ul id={LISTBOX_ID} role="listbox" className="max-h-[320px] overflow-y-auto p-2" data-testid="global-search-results">
            {isEmptyQuery && list.length === 0 ? (
              <li className="p-4 text-sm text-center text-muted-foreground">Type to search.</li>
            ) : !isEmptyQuery && list.length === 0 ? (
              <li className="p-4 text-sm text-center text-muted-foreground" data-testid="global-search-empty">No matches.</li>
            ) : (
              <>
                {isEmptyQuery && (
                  <li className="px-3 pt-1 pb-2 text-xs font-black uppercase tracking-widest text-muted-foreground" data-testid="global-search-recent-heading">
                    Recent
                  </li>
                )}
                {list.map((hit, i) => (
                  <li key={`${hit.type}:${hit.id}`}>
                    <button
                      type="button"
                      id={optionId(i)}
                      role="option"
                      onClick={() => go(hit)}
                      aria-selected={i === active}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${i === active ? "bg-foreground text-background" : "hover:bg-muted"}`}
                    >
                      <span className="truncate">{hit.label}</span>
                      <span className="shrink-0 text-xs font-black uppercase tracking-widest opacity-70">{TYPE_LABEL[hit.type]}</span>
                    </button>
                  </li>
                ))}
              </>
            )}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
