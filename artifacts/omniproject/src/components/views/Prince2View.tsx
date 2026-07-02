import { useMemo, useState } from "react";
import { useGetProjectIssues, type Issue } from "@workspace/api-client-react";
import { format } from "date-fns";
import { ShieldAlert } from "lucide-react";
import { Link } from "wouter";
import {
  prince2Stage,
  PRINCE2_STAGES,
  isOverdue,
  isDone,
  completion,
  ragFor,
  RAG_DOT,
  RAG_TEXT,
} from "../../lib/methodology";
import { STATUS_LABELS, STATUS_COLORS } from "../../lib/constants";
import { resolveDrillTo, overdueDrillTo } from "../../lib/drill-to";
import { DataState } from "../DataState";
import { IssueDialog } from "../IssueDialog";

export function Prince2View({ projectId }: { projectId: string }) {
  const { data: issues, isLoading, isError, error, refetch } = useGetProjectIssues(projectId);
  const [editing, setEditing] = useState<Issue | null>(null);
  // Same "overdue" drill-through as the exec board pack / portfolio KPI cards' schedule-variance
  // figure (backlog #132) — the PRINCE2 highlight report's own "Exceptions (overdue)" tally is just
  // another red number a PM expects to click through to the offending products.
  const exceptionsDrill = resolveDrillTo(overdueDrillTo(), { projectId });

  const model = useMemo(() => {
    const all = issues ?? [];
    const stageNames = Array.from(new Set([...PRINCE2_STAGES, ...all.map(prince2Stage)]));
    const stages = stageNames
      .map((name) => {
        const products = all.filter((i) => prince2Stage(i) === name);
        const overdue = products.filter(isOverdue).length;
        const pct = completion(products);
        return { name, products, overdue, pct, rag: ragFor(pct, overdue) };
      })
      .filter((s) => s.products.length > 0);

    const total = all.length;
    const delivered = all.filter((i) => isDone(i.status)).length;
    const exceptions = all.filter(isOverdue).length;
    const pct = completion(all);
    const next = all
      .filter((i) => i.dueDate && !isDone(i.status))
      .map((i) => i.dueDate as string)
      .sort()[0];
    return { stages, total, delivered, exceptions, pct, rag: ragFor(pct, exceptions), next };
  }, [issues]);

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()}>
      <div className="h-full overflow-y-auto space-y-6">
        {/* Highlight report */}
        <div className="bg-card border-2 border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-black uppercase tracking-widest text-sm">Highlight Report</h3>
            <span className={`flex items-center gap-1.5 text-xs font-black uppercase tracking-widest ${RAG_TEXT[model.rag]}`}>
              <span className={`w-3 h-3 rounded-full ${RAG_DOT[model.rag]}`} /> {model.rag}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm font-mono">
            <div><div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Products delivered</div><div className="font-black text-lg">{model.delivered}/{model.total}</div></div>
            <div><div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Completion</div><div className="font-black text-lg text-green-500">{model.pct}%</div></div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Exceptions (overdue)</div>
              {model.exceptions > 0 && exceptionsDrill ? (
                <Link
                  href={exceptionsDrill.href}
                  className="font-black text-lg text-red-500 underline decoration-dotted underline-offset-2 hover:no-underline"
                  aria-label={`${exceptionsDrill.label} for this project`}
                  data-testid="prince2-exceptions-drill"
                >
                  {model.exceptions}
                </Link>
              ) : (
                <div className={`font-black text-lg ${model.exceptions > 0 ? "text-red-500" : ""}`}>{model.exceptions}</div>
              )}
            </div>
            <div><div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Next milestone</div><div className="font-black text-lg">{model.next ? format(new Date(model.next), "MMM dd") : "—"}</div></div>
          </div>
          {model.exceptions > 0 && (
            <div className="mt-4 flex items-center gap-2 text-xs text-red-500 border border-red-500/40 bg-red-500/5 px-3 py-2">
              <ShieldAlert className="w-4 h-4" /> Tolerance breach: {model.exceptions} product(s) overdue — escalate per exception management.
            </div>
          )}
        </div>

        {/* Management stages */}
        <div className="space-y-4">
          {model.stages.map((stage) => (
            <div key={stage.name} className="bg-card border border-border">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`w-3 h-3 rounded-full ${RAG_DOT[stage.rag]}`} />
                  <h4 className="font-black uppercase tracking-wider text-sm">Stage · {stage.name}</h4>
                  <span className="text-xs text-muted-foreground font-mono">{stage.products.length} products · {stage.pct}%</span>
                </div>
                {stage.overdue > 0 && <span className="text-xs font-bold text-red-500 uppercase">{stage.overdue} overdue</span>}
              </div>
              <div className="h-1.5 bg-muted"><div className="h-full bg-green-500" style={{ width: `${stage.pct}%` }} /></div>
              <div className="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                {stage.products.map((issue) => (
                  <button
                    key={issue.id}
                    onClick={() => setEditing(issue)}
                    className={`text-left border border-border p-2 hover:border-primary flex items-center gap-2 ${isOverdue(issue) ? "bg-red-500/5" : "bg-background"}`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[issue.status]}`} title={STATUS_LABELS[issue.status]} />
                    <span className="text-sm truncate flex-1">{issue.title}</span>
                    {isOverdue(issue) && <span className="text-[10px] text-red-500 font-bold shrink-0">!</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <IssueDialog projectId={projectId} open={!!editing} onOpenChange={(o) => !o && setEditing(null)} issue={editing} />
    </DataState>
  );
}
