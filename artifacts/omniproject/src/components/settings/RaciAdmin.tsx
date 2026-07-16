import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Grid3x3 } from "lucide-react";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { useToast } from "@/hooks/use-toast";
import { useRaci, useSaveRaci, type RaciEntry, type RaciResponsibility } from "../../lib/raci";
import { AdminSection } from "./AdminSection";
import { EditableRowTable } from "./EditableRowTable";

/**
 * RACI register (manager+) — the CONTENT editor behind the RACI matrix screen. Flat (task, role,
 * responsibility) rows; the screen renders them via the generic table. Separate content admin from the
 * on-screen layout editor, per the JSON-backed split.
 */
const RESP: RaciResponsibility[] = ["R", "A", "C", "I"];
const empty = (n: number): RaciEntry => ({ id: `raci-${n}`, task: "", role: "", responsibility: "R" });

export function RaciAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = useRaci();
  const save = useSaveRaci();
  const { toast } = useToast();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<RaciEntry[], RaciEntry[]>(server, structuredClone);

  if (!roleAtLeast(auth?.role, "manager")) return null;

  const rows = draft ?? [];
  const set = (i: number, patch: Partial<RaciEntry>) => setDraft(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const badRows = new Set<number>();
  const seen = new Set<string>();
  rows.forEach((r, i) => { const id = r.id.trim(); if (!id || !r.task.trim() || !r.role.trim() || seen.has(id)) badRows.add(i); if (id) seen.add(id); });

  const onSave = () => {
    const cleaned = rows.map((r) => ({ id: r.id.trim(), task: r.task.trim(), role: r.role.trim(), responsibility: r.responsibility }));
    save.mutate(cleaned, {
      onSuccess: () => toast({ title: "RACI SAVED", description: "Responsibility assignments updated." }),
      onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
    });
  };

  return (
    <AdminSection icon={Grid3x3} title="RACI matrix" testId="raci-admin" bodyClassName="space-y-4">
      <p className="text-xs text-muted-foreground">Who is Responsible, Accountable, Consulted or Informed for each task. The RACI screen renders these rows.</p>
      {rows.length === 0 && <p className="text-xs text-muted-foreground" data-testid="raci-empty">No RACI entries yet.</p>}
      <EditableRowTable
        rows={rows}
        rowKey={(_, i) => i}
        rowTestId={(_, i) => `raci-row-${i}`}
        rowClassName={(_, i) => (badRows.has(i) ? "bg-red-500/10" : undefined)}
        onRemove={(i) => setDraft(rows.filter((_, j) => j !== i))}
        removeLabel={(i) => `Remove RACI entry ${i + 1}`}
        emptyText="No entries."
        columns={[
          { header: "Task", cell: (r, i) => <Input aria-label={`Entry ${i + 1} task`} value={r.task} onChange={(e) => set(i, { task: e.target.value })} className="h-8 max-w-52" /> },
          { header: "Role", cell: (r, i) => <Input aria-label={`Entry ${i + 1} role`} value={r.role} onChange={(e) => set(i, { role: e.target.value })} className="h-8 max-w-40" /> },
          { header: "R/A/C/I", cell: (r, i) => (
            <select aria-label={`Entry ${i + 1} responsibility`} value={r.responsibility} onChange={(e) => set(i, { responsibility: e.target.value as RaciResponsibility })} className="h-8 border-2 border-foreground bg-background px-1 text-xs font-bold">
              {RESP.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          ) },
        ]}
      />
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setDraft([...rows, empty(rows.length + 1)])} data-testid="raci-add">Add entry</Button>
        {dirty && <Button type="button" variant="ghost" size="sm" onClick={reset}>Reset</Button>}
        <Button type="button" size="sm" onClick={onSave} disabled={!dirty || badRows.size > 0 || save.isPending} data-testid="raci-save">{save.isPending ? "SAVING…" : "Save RACI"}</Button>
      </div>
    </AdminSection>
  );
}
