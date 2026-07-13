import { Link } from "wouter";
import { useEffect } from "react";
import { useGetProgramme, useGetCapabilities, type Project } from "@workspace/api-client-react";
import { ArrowLeft, Layers } from "lucide-react";
import { LoadingState } from "../components/LoadingState";
import { useRecentItems } from "../lib/recent-items";
import { ProgrammeFinancialsCard } from "../components/ProgrammeFinancialsCard";
import { DataProvenance } from "../components/DataProvenance";
import { RAG_DOT, RAG_TEXT } from "../lib/methodology";

const PROGRAMME_PROJECT_FIELDS = [
  { key: "name", label: "Name" },
  { key: "issueCount", label: "Issues" },
  { key: "completedCount", label: "Completed" },
  { key: "source", label: "Source" },
];
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-border bg-background p-3 text-center">
      <div className="text-2xl font-black font-mono">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

function ProjectRow({ p }: { p: Project }) {
  const pct = p.issueCount > 0 ? Math.round((p.completedCount / p.issueCount) * 100) : 0;
  return (
    <Link href={`/projects/${p.id}`} className="block border border-border bg-card p-4 hover:border-primary">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-mono border border-border px-1 shrink-0">{p.identifier}</span>
          <span className="font-bold truncate">{p.name}</span>
        </div>
        <span className="text-xs px-1.5 py-0.5 border border-border bg-muted/50 uppercase tracking-widest shrink-0">{p.source}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
        <span className="text-[11px] font-mono text-muted-foreground shrink-0">{p.completedCount}/{p.issueCount} · {pct}%</span>
      </div>
    </Link>
  );
}

export function ProgrammeDetail({ programmeId }: { programmeId: string }) {
  const { data: prog, isLoading, isError, dataUpdatedAt } = useGetProgramme(programmeId);
  const { data: caps } = useGetCapabilities();

  // Remember this visit for the "Recent" quick-find list (findability).
  const recordRecent = useRecentItems((s) => s.record);
  useEffect(() => {
    if (prog) recordRecent({ type: "programme", id: prog.id, label: prog.name });
  }, [prog, recordRecent]);

  if (isLoading) return <LoadingState />;
  if (isError || !prog) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Link href="/programmes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"><ArrowLeft className="w-4 h-4" /> Programmes</Link>
        <h1 className="text-3xl font-black uppercase tracking-tighter mb-4">Programme not found</h1>
        <div className="bg-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground">This programme no longer exists or has no member projects.</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <Breadcrumb className="mb-3">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href="/programmes">Programmes</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{prog.name}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <Layers className="w-6 h-6 text-muted-foreground" />
              <h1 className="text-3xl font-black uppercase tracking-tighter">{prog.name}</h1>
            </div>
            <div className="flex items-center gap-3">
              <span className={`flex items-center gap-2 text-sm font-black uppercase tracking-widest ${RAG_TEXT[prog.ragStatus]}`}>
                <span className={`w-3 h-3 rounded-full ${RAG_DOT[prog.ragStatus]}`} /> {prog.ragStatus}
              </span>
              {prog.projects.length > 0 && (
                <DataProvenance rows={prog.projects as unknown as Record<string, unknown>[]} fields={PROGRAMME_PROJECT_FIELDS} mode={caps?.mode}
                  filename={`programme-${programmeId}`} fieldSources={caps?.fieldSources} polledAt={dataUpdatedAt} />
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Projects" value={prog.projectCount} />
          <Stat label="Issues" value={prog.issueCount} />
          <Stat label="Completed" value={prog.completedCount} />
          <Stat label="Completion" value={`${prog.completionRate}%`} />
        </div>

        {prog.financials && <ProgrammeFinancialsCard financials={prog.financials} />}

        <section>
          <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">Projects in this programme</h2>
          <div className="grid grid-cols-1 gap-3">
            {prog.projects.map((p) => <ProjectRow key={p.id} p={p} />)}
          </div>
        </section>
      </div>
    </div>
  );
}
