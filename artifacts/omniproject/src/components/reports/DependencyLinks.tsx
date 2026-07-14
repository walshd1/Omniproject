import { useEffect, useRef, useState } from "react";
import {
  useListProjects,
  useGetProjectIssues,
  getGetProjectIssuesQueryKey,
  type Issue,
} from "@workspace/api-client-react";
import { Link2, Download, Upload, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { ProvenanceBadge } from "../ProvenanceBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  loadEdges,
  addEdges,
  removeEdge,
  createEdge,
  exportEdges,
  parseEdgeFile,
  checkDrift,
  type DependencyEdge,
  type DependencyType,
  type DriftResult,
  type ItemRef,
} from "../../lib/dependencies";

const TYPES: { value: DependencyType; label: string }[] = [
  { value: "blocks", label: "blocks" },
  { value: "depends_on", label: "depends on" },
  { value: "relates_to", label: "relates to" },
];

/**
 * Cross-system dependency links, by HASH ONLY. We store two opaque fingerprints
 * + the minimal refs to re-read each endpoint live — never any content — so this
 * stays an overlay, not a shadow PM database. Edges live in the browser session
 * (volatile) and export to a file. On render we re-read the live items and
 * re-hash to flag drift ("this side changed since you linked it").
 */
export function DependencyLinks() {
  const { data: projects } = useListProjects();
  const { toast } = useToast();

  const [edges, setEdges] = useState<DependencyEdge[]>(() => loadEdges());
  const [fromProject, setFromProject] = useState("");
  const [toProject, setToProject] = useState("");
  const [fromIssue, setFromIssue] = useState("");
  const [toIssue, setToIssue] = useState("");
  const [type, setType] = useState<DependencyType>("blocks");
  const [drift, setDrift] = useState<Record<string, DriftResult | null>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: fromIssues } = useGetProjectIssues(fromProject, {
    query: { enabled: !!fromProject, queryKey: getGetProjectIssuesQueryKey(fromProject) },
  });
  const { data: toIssues } = useGetProjectIssues(toProject, {
    query: { enabled: !!toProject, queryKey: getGetProjectIssuesQueryKey(toProject) },
  });

  // Live item lookup keyed by `${projectId}:${issueId}` for drift recomputation.
  const liveItems: Record<string, Issue> = {};
  for (const i of fromIssues ?? []) liveItems[`${fromProject}:${i.id}`] = i;
  for (const i of toIssues ?? []) liveItems[`${toProject}:${i.id}`] = i;

  // Recompute drift for any edge whose BOTH endpoints are currently loaded.
  useEffect(() => {
    let alive = true;
    (async () => {
      // Each edge's SHA-256 digest is independent, so compute them concurrently instead of
      // awaiting one-at-a-time. Assemble `next` in edge order afterwards for identical contents.
      const results = await Promise.all(
        edges.map(async (e) => {
          const f = liveItems[`${e.from.projectRef}:${e.from.itemRef}`];
          const t = liveItems[`${e.to.projectRef}:${e.to.itemRef}`];
          const value = f && t ? await checkDrift(e, f as unknown as Record<string, unknown>, t as unknown as Record<string, unknown>) : null;
          return [e.edgeKey, value] as const;
        }),
      );
      const next: Record<string, DriftResult | null> = {};
      for (const [key, value] of results) next[key] = value;
      if (alive) setDrift(next);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edges, fromIssues, toIssues]);

  const refFor = (projectId: string, issueId: string): ItemRef => ({
    system: projects?.find((p) => p.id === projectId)?.source ?? "unknown",
    projectRef: projectId,
    itemRef: issueId,
  });

  const link = async () => {
    const fromItem = (fromIssues ?? []).find((i) => i.id === fromIssue);
    const toItem = (toIssues ?? []).find((i) => i.id === toIssue);
    if (!fromItem || !toItem) {
      toast({ title: "PICK BOTH ENDPOINTS", description: "Choose a source and target item.", variant: "destructive" });
      return;
    }
    if (fromProject === toProject && fromIssue === toIssue) {
      toast({ title: "INVALID LINK", description: "An item can't depend on itself.", variant: "destructive" });
      return;
    }
    const edge = await createEdge(
      refFor(fromProject, fromIssue),
      refFor(toProject, toIssue),
      type,
      fromItem as unknown as Record<string, unknown>,
      toItem as unknown as Record<string, unknown>,
    );
    setEdges(addEdges(edges, [edge]));
    toast({ title: "DEPENDENCY LINKED", description: "Stored two fingerprints — no item content kept." });
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    const imported = parseEdgeFile(await file.text());
    if (imported.length === 0) {
      toast({ title: "IMPORT FAILED", description: "No valid dependency edges in that file.", variant: "destructive" });
      return;
    }
    setEdges(addEdges(edges, imported));
    toast({ title: "DEPENDENCIES IMPORTED", description: `${imported.length} edge(s) added.` });
  };

  const driftedCount = Object.values(drift).filter((d) => d?.drifted).length;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Cross-System Dependencies</h2>
          <ProvenanceBadge provenance="captured" />
          {driftedCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-500 border border-amber-500/40 px-2 py-0.5" data-testid="drift-count">
              <AlertTriangle className="w-3.5 h-3.5" /> {driftedCount} drifted
            </span>
          )}
        </div>
      </div>

      <div className="bg-card border border-border p-4 space-y-4">
        {/* Link builder */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto] gap-2 items-center">
          <ItemPicker
            label="Source"
            projects={projects}
            projectId={fromProject}
            setProjectId={(v) => { setFromProject(v); setFromIssue(""); }}
            issues={fromIssues}
            issueId={fromIssue}
            setIssueId={setFromIssue}
            testid="dep-from"
          />
          <Select value={type} onValueChange={(v) => setType(v as DependencyType)}>
            <SelectTrigger aria-label="Dependency type" className="w-auto rounded-none bg-background border-border px-2 py-2 text-xs font-bold uppercase" data-testid="dep-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none border-border font-bold uppercase">
              {TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <ItemPicker
            label="Target"
            projects={projects}
            projectId={toProject}
            setProjectId={(v) => { setToProject(v); setToIssue(""); }}
            issues={toIssues}
            issueId={toIssue}
            setIssueId={setToIssue}
            testid="dep-to"
          />
          <button
            type="button"
            onClick={() => void link()}
            className="inline-flex items-center gap-2 border border-primary bg-primary text-primary-foreground px-3 py-2 text-xs font-black uppercase tracking-widest hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="dep-link"
          >
            <Link2 className="w-4 h-4" /> Link
          </button>
        </div>

        {/* Edge list */}
        {edges.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6" data-testid="dep-empty">
            No dependencies linked. Pick a source and target item to assert a cross-system dependency by fingerprint.
          </div>
        ) : (
          <ul className="divide-y divide-border border-t border-border" aria-label="Dependency edges">
            {edges.map((e) => {
              const d = drift[e.edgeKey];
              return (
                <li key={e.edgeKey} className="flex items-center justify-between gap-3 py-2 text-xs font-mono" data-testid={`dep-edge-${e.edgeKey.slice(0, 8)}`}>
                  <span className="truncate">
                    <span className="font-bold">{e.from.system}:{e.from.itemRef}</span>
                    <span className="text-muted-foreground"> {e.type.replace("_", " ")} </span>
                    <span className="font-bold">{e.to.system}:{e.to.itemRef}</span>
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    {d == null ? (
                      <span className="text-muted-foreground/60" title="Select both endpoints' projects to check drift">—</span>
                    ) : d.drifted ? (
                      <span className="flex items-center gap-1 text-amber-500" title="An endpoint changed since you linked it">
                        <AlertTriangle className="w-3.5 h-3.5" /> drifted
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-green-500" title="Both endpoints unchanged since linked">
                        <CheckCircle2 className="w-3.5 h-3.5" /> fresh
                      </span>
                    )}
                    <button type="button" onClick={() => exportEdges([e])} aria-label="Export this edge" title="Export" className="p-1 text-muted-foreground hover:text-primary focus:outline-none focus:ring-2 focus:ring-ring">
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => setEdges(removeEdge(edges, e.edgeKey))} aria-label="Delete this edge" title="Delete" className="p-1 text-muted-foreground hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-ring">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Bulk actions */}
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 border border-border px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring">
            <Upload className="w-4 h-4" /> Import
          </button>
          <button type="button" onClick={() => exportEdges(edges)} disabled={edges.length === 0} className="inline-flex items-center gap-2 border border-border px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-ring">
            <Download className="w-4 h-4" /> Export all
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" aria-hidden="true" tabIndex={-1} onChange={(e) => { void onImport(e.target.files?.[0]); e.target.value = ""; }} />
        </div>

        <p className="text-[11px] text-muted-foreground">
          Only two SHA-256 fingerprints and the item references are stored — never titles, statuses or content. Endpoints are
          re-read live to detect drift. Held in this browser session; export to keep. OmniProject stores nothing on the server.
        </p>
      </div>
    </section>
  );
}

function ItemPicker({
  label,
  projects,
  projectId,
  setProjectId,
  issues,
  issueId,
  setIssueId,
  testid,
}: {
  label: string;
  projects?: { id: string; name: string }[] | undefined;
  projectId: string;
  setProjectId: (v: string) => void;
  issues?: Issue[] | undefined;
  issueId: string;
  setIssueId: (v: string) => void;
  testid: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Select value={projectId} onValueChange={setProjectId}>
        <SelectTrigger aria-label={`${label} project`} className="rounded-none bg-background border-border px-2 py-2 text-xs font-bold uppercase" data-testid={`${testid}-project`}>
          <SelectValue placeholder={`${label} project`} />
        </SelectTrigger>
        <SelectContent className="rounded-none border-border font-bold uppercase">
          {(projects ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={issueId} onValueChange={setIssueId} disabled={!projectId}>
        <SelectTrigger aria-label={`${label} item`} className="rounded-none bg-background border-border px-2 py-2 text-xs font-mono" data-testid={`${testid}-issue`}>
          <SelectValue placeholder={projectId ? "Select item…" : "Pick a project first"} />
        </SelectTrigger>
        <SelectContent className="rounded-none border-border font-mono max-h-64">
          {(issues ?? []).map((i) => <SelectItem key={i.id} value={i.id}>{i.id.slice(0, 8)} · {i.title}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
