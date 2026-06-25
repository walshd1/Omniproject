import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProjectRaid,
  useCreateRaidEntry,
  getGetProjectRaidQueryKey,
  type RaidEntry,
  type RaidEntryInput,
} from "@workspace/api-client-react";
import { DataState } from "../DataState";
import { useToast } from "@/hooks/use-toast";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { ProvenanceBadge } from "../ProvenanceBadge";

const TYPES: { id: RaidEntry["type"]; label: string; blurb: string }[] = [
  { id: "risk", label: "Risks", blurb: "Things that might happen" },
  { id: "assumption", label: "Assumptions", blurb: "Taken as true for now" },
  { id: "issue", label: "Issues", blurb: "Already happening" },
  { id: "dependency", label: "Dependencies", blurb: "Reliant on others" },
];

const SEVERITY_CLS: Record<string, string> = {
  critical: "text-red-500 border-red-500/40 bg-red-500/10",
  high: "text-orange-500 border-orange-500/40 bg-orange-500/10",
  medium: "text-amber-500 border-amber-500/40 bg-amber-500/10",
  low: "text-zinc-400 border-border bg-muted/40",
};

const STATUS_CLS: Record<string, string> = {
  open: "text-red-500",
  mitigating: "text-amber-500",
  closed: "text-green-500",
};

function Card({ e }: { e: RaidEntry }) {
  return (
    <div className="bg-background border border-border p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-sm leading-tight">{e.title}</span>
        <span className={`shrink-0 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-widest border ${SEVERITY_CLS[e.severity] ?? SEVERITY_CLS.low}`}>
          {e.severity}
        </span>
      </div>
      {e.description && <p className="text-xs text-muted-foreground">{e.description}</p>}
      {e.mitigation && <p className="text-xs"><span className="text-muted-foreground uppercase tracking-widest text-[10px]">Mitigation · </span>{e.mitigation}</p>}
      <div className="flex items-center gap-3 text-[11px] font-mono text-muted-foreground">
        <span className={`font-bold uppercase ${STATUS_CLS[e.status] ?? ""}`}>{e.status}</span>
        {e.owner && <span>@{e.owner}</span>}
        {e.dueDate && <span>due {e.dueDate}</span>}
      </div>
    </div>
  );
}

export function RaidView({ projectId }: { projectId: string }) {
  const { data: entries, isLoading, isError, error, refetch } = useGetProjectRaid(projectId);
  const { data: auth } = useAuth();
  const canWrite = roleAtLeast(auth?.role, "contributor");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const create = useCreateRaidEntry();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<RaidEntryInput>({ type: "risk", title: "", severity: "medium", status: "open" });

  const grouped = useMemo(() => {
    const all = entries ?? [];
    return TYPES.map((t) => ({ ...t, items: all.filter((e) => e.type === t.id) }));
  }, [entries]);

  const provenance = entries?.[0]?.provenance;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast({ title: "TITLE REQUIRED", variant: "destructive" });
      return;
    }
    create.mutate(
      { projectId, data: { ...form, title: form.title.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetProjectRaidQueryKey(projectId) });
          toast({ title: "RAID ENTRY ADDED", description: form.title });
          setForm({ type: "risk", title: "", severity: "medium", status: "open" });
          setAdding(false);
        },
        onError: () => toast({ title: "ERROR", description: "Could not add entry.", variant: "destructive" }),
      },
    );
  };

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()}>
    <div className="h-full flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">RAID Register</h2>
          <ProvenanceBadge provenance={provenance} />
        </div>
        {canWrite && (
          <button
            onClick={() => setAdding((v) => !v)}
            className="text-xs font-black uppercase tracking-widest border border-primary text-primary px-3 py-1.5 hover:bg-primary hover:text-primary-foreground"
          >
            {adding ? "Cancel" : "+ Add entry"}
          </button>
        )}
      </div>

      {adding && canWrite && (
        <form onSubmit={submit} className="bg-card border border-border p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            placeholder="Title"
            className="sm:col-span-2 bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-primary"
            autoFocus
          />
          <textarea
            value={form.description ?? ""}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            placeholder="Description"
            rows={2}
            className="sm:col-span-2 bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-primary resize-none"
          />
          <select value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as RaidEntryInput["type"] }))} className="bg-background border border-border px-3 py-2 text-sm font-mono uppercase">
            {TYPES.map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}
          </select>
          <select value={form.severity} onChange={(e) => setForm((p) => ({ ...p, severity: e.target.value as RaidEntryInput["severity"] }))} className="bg-background border border-border px-3 py-2 text-sm font-mono uppercase">
            {["low", "medium", "high", "critical"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            value={form.owner ?? ""}
            onChange={(e) => setForm((p) => ({ ...p, owner: e.target.value || null }))}
            placeholder="Owner"
            className="bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-primary"
          />
          <input
            type="date"
            value={form.dueDate ?? ""}
            onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value || null }))}
            className="bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-primary"
          />
          <button type="submit" disabled={create.isPending} className="sm:col-span-2 bg-primary text-primary-foreground font-black uppercase tracking-widest py-2 hover:bg-primary/90">
            {create.isPending ? "SAVING…" : "Add to register"}
          </button>
        </form>
      )}

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 min-h-0">
        {grouped.map((col) => (
          <div key={col.id} className="bg-card border border-border flex flex-col min-h-0">
            <div className="p-3 border-b border-border bg-background">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm tracking-wider uppercase">{col.label}</span>
                <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 font-mono">{col.items.length}</span>
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest">{col.blurb}</div>
            </div>
            <div className="flex-1 p-3 flex flex-col gap-2 overflow-y-auto">
              {col.items.map((e) => <Card key={e.id} e={e} />)}
              {col.items.length === 0 && <div className="text-[11px] text-muted-foreground/60 text-center py-6 uppercase tracking-widest">None logged</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
    </DataState>
  );
}
