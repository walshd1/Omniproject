import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users2 } from "lucide-react";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { useToast } from "@/hooks/use-toast";
import { useStakeholders, useSaveStakeholders, type Stakeholder, type Level } from "../../lib/stakeholders";
import { AdminSection } from "./AdminSection";
import { EditableRowTable } from "./EditableRowTable";

/**
 * Stakeholder register (manager+) — the CONTENT editor behind the Stakeholders screen. Flat rows of
 * (name, role, influence, interest, engagement); the screen renders them via the generic table.
 */
const LEVELS: Level[] = ["low", "medium", "high"];
const empty = (n: number): Stakeholder => ({ id: `stk-${n}`, name: "", role: "", influence: "medium", interest: "medium" });

export function StakeholdersAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = useStakeholders();
  const save = useSaveStakeholders();
  const { toast } = useToast();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<Stakeholder[], Stakeholder[]>(server);

  if (!roleAtLeast(auth?.role, "manager")) return null;

  const rows = draft ?? [];
  const set = (i: number, patch: Partial<Stakeholder>) => setDraft(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const badRows = new Set<number>();
  const seen = new Set<string>();
  rows.forEach((r, i) => { const id = r.id.trim(); if (!id || !r.name.trim() || seen.has(id)) badRows.add(i); if (id) seen.add(id); });

  const onSave = () => {
    const cleaned = rows.map((r) => ({ id: r.id.trim(), name: r.name.trim(), role: r.role.trim(), influence: r.influence, interest: r.interest, ...(r.engagement?.trim() ? { engagement: r.engagement.trim() } : {}) }));
    save.mutate(cleaned, {
      onSuccess: () => toast({ title: "STAKEHOLDERS SAVED", description: "Register updated." }),
      onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
    });
  };

  const levelSelect = (i: number, key: "influence" | "interest", value: Level) => (
    <select aria-label={`Stakeholder ${i + 1} ${key}`} value={value} onChange={(e) => set(i, { [key]: e.target.value as Level })} className="h-8 border border-foreground bg-background px-1 text-xs">
      {LEVELS.map((x) => <option key={x} value={x}>{x}</option>)}
    </select>
  );

  return (
    <AdminSection icon={Users2} title="Stakeholders" testId="stakeholders-admin" bodyClassName="space-y-4">
      <p className="text-xs text-muted-foreground">The stakeholder register (influence / interest / engagement). The Stakeholders screen renders these rows.</p>
      {rows.length === 0 && <p className="text-xs text-muted-foreground" data-testid="stakeholders-empty">No stakeholders yet.</p>}
      <EditableRowTable
        rows={rows}
        rowKey={(_, i) => i}
        rowTestId={(_, i) => `stakeholder-row-${i}`}
        rowClassName={(_, i) => (badRows.has(i) ? "bg-red-500/10" : undefined)}
        onRemove={(i) => setDraft(rows.filter((_, j) => j !== i))}
        removeLabel={(i) => `Remove stakeholder ${i + 1}`}
        emptyText="No stakeholders."
        columns={[
          { header: "Name", cell: (r, i) => <Input aria-label={`Stakeholder ${i + 1} name`} value={r.name} onChange={(e) => set(i, { name: e.target.value })} className="h-8 max-w-40" /> },
          { header: "Role", cell: (r, i) => <Input aria-label={`Stakeholder ${i + 1} role`} value={r.role} onChange={(e) => set(i, { role: e.target.value })} className="h-8 max-w-40" /> },
          { header: "Influence", cell: (r, i) => levelSelect(i, "influence", r.influence) },
          { header: "Interest", cell: (r, i) => levelSelect(i, "interest", r.interest) },
          { header: "Engagement", cell: (r, i) => <Input aria-label={`Stakeholder ${i + 1} engagement`} value={r.engagement ?? ""} onChange={(e) => set(i, { engagement: e.target.value })} className="h-8 max-w-40" /> },
        ]}
      />
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setDraft([...rows, empty(rows.length + 1)])} data-testid="stakeholder-add">Add stakeholder</Button>
        {dirty && <Button type="button" variant="ghost" size="sm" onClick={reset}>Reset</Button>}
        <Button type="button" size="sm" onClick={onSave} disabled={!dirty || badRows.size > 0 || save.isPending} data-testid="stakeholders-save">{save.isPending ? "SAVING…" : "Save stakeholders"}</Button>
      </div>
    </AdminSection>
  );
}
