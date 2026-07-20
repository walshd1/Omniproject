import { useMemo } from "react";
import { Link } from "wouter";
import { useListProgrammes, useListProjects, useGetCapabilities, type Programme, type Project } from "@workspace/api-client-react";
import { Layers, FolderOpen } from "lucide-react";
import { useT } from "../lib/i18n";
import { RAG_DOT, RAG_TEXT } from "../lib/methodology";
import { LoadingState } from "../components/LoadingState";
import { DataProvenance } from "../components/DataProvenance";
import { useProgrammeRegistry, memberInstanceIds } from "../lib/programme-registry";

const PROGRAMME_FIELDS = [
  { key: "ragStatus", label: "RAG status" },
  { key: "projectCount", label: "Projects" },
  { key: "issueCount", label: "Issues" },
  { key: "completionRate", label: "Completion" },
];

function ProgrammeCard({ p }: { p: Programme }) {
  return (
    <Link href={`/programmes/${p.id}`} className="block border border-border bg-card p-5 hover:border-primary transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-black uppercase tracking-tight text-lg leading-none">{p.name}</h3>
        </div>
        <span className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest ${RAG_TEXT[p.ragStatus]}`}>
          <span className={`w-2 h-2 rounded-full ${RAG_DOT[p.ragStatus]}`} /> {p.ragStatus}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center mb-3">
        <div><div className="text-xl font-black font-mono">{p.projectCount}</div><div className="text-[10px] uppercase tracking-widest text-muted-foreground">Projects</div></div>
        <div><div className="text-xl font-black font-mono">{p.issueCount}</div><div className="text-[10px] uppercase tracking-widest text-muted-foreground">Issues</div></div>
        <div><div className="text-xl font-black font-mono">{p.completionRate}%</div><div className="text-[10px] uppercase tracking-widest text-muted-foreground">Done</div></div>
      </div>
      <div className="h-1.5 bg-muted overflow-hidden">
        <div className={`h-full ${RAG_DOT[p.ragStatus]}`} style={{ width: `${p.completionRate}%` }} />
      </div>
    </Link>
  );
}

export function Programmes() {
  const { t } = useT();
  const { data: programmes, isLoading, dataUpdatedAt } = useListProgrammes();
  const { data: projects } = useListProjects();
  const { data: caps } = useGetCapabilities();
  const { data: registry } = useProgrammeRegistry();
  // Standalone = not a member of any programme. Membership is by the project's correlation GUID
  // against the registry (the source of truth), not the backend programmeId. Memoized so the
  // registry Set + filter don't rebuild on every unrelated render.
  const standalone = useMemo(() => {
    const members = memberInstanceIds(registry);
    return (projects ?? []).filter((p: Project) => !members.has((p as { omniInstanceId?: string }).omniInstanceId ?? ""));
  }, [projects, registry]);

  if (isLoading) return <LoadingState />;

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-6xl mx-auto space-y-10">
        <div className="pb-4 border-b border-border">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-3xl font-black uppercase tracking-tighter">{t("nav.programmes")}</h1>
            {programmes && programmes.length > 0 && (
              <DataProvenance rows={programmes as unknown as Record<string, unknown>[]} fields={PROGRAMME_FIELDS} mode={caps?.mode}
                filename="programmes" sourceAccessor={() => "rollup"} fieldSources={caps?.fieldSources} polledAt={dataUpdatedAt} />
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Programme-wide roll-up across related projects. A programme exists only where projects are grouped; ungrouped
            projects are listed as standalone.
          </p>
        </div>

        {programmes && programmes.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {programmes.map((p) => <ProgrammeCard key={p.id} p={p} />)}
          </div>
        ) : (
          <div className="bg-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No programmes — no projects are grouped under a programme yet.
          </div>
        )}

        {standalone.length > 0 && (
          <section>
            <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">Standalone projects ({standalone.length})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {standalone.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center gap-3 border border-border bg-card p-3 hover:border-primary">
                  <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="font-semibold text-sm truncate flex-1">{p.name}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">{p.completedCount}/{p.issueCount}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
