import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Boxes } from "lucide-react";
import { AdminSection } from "./AdminSection";
import { useAuth, isPmoOrAdmin } from "../../lib/auth";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { useToast } from "@/hooks/use-toast";
import { useProgrammeRegistry, useSaveProgrammeRegistry, type ProgrammeRegistry } from "../../lib/programme-registry";
import { EditableRowTable } from "./EditableRowTable";

interface Row { id: string; name: string; guids: string }
const empty = (): Row => ({ id: "", name: "", guids: "" });
const toRows = (reg: ProgrammeRegistry): Row[] => Object.entries(reg).map(([id, d]) => ({ id, name: d.name, guids: d.instanceIds.join(", ") }));

/**
 * Programmes (admin/PMO) — the source of truth for programme membership. A programme is a chosen
 * NAME plus the project correlation GUIDs (`omniInstanceId`) that belong to it; a project is in the
 * programme iff its GUID is listed. Backend-independent — the same programme can span projects across
 * different backends. The server re-validates and seals this at rest.
 */
export function ProgrammeRegistryAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = useProgrammeRegistry();
  const save = useSaveProgrammeRegistry();
  const { toast } = useToast();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<ProgrammeRegistry, Row[]>(server, toRows);

  // Programmes are governed by either authority — PMO (business) or admin (technical).
  if (!isPmoOrAdmin(auth?.role)) return null;

  const rows = draft ?? [];
  const set = (i: number, patch: Partial<Row>) => setDraft(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // Local shape feedback: a programme needs a unique, non-empty id.
  const badRows = new Set<number>();
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const id = r.id.trim();
    if (!id || seen.has(id)) badRows.add(i);
    if (id) seen.add(id);
  });

  const onSave = () => {
    const reg: ProgrammeRegistry = {};
    for (const r of rows) {
      const id = r.id.trim();
      if (!id) continue;
      reg[id] = { name: r.name.trim() || id, instanceIds: [...new Set(r.guids.split(",").map((s) => s.trim()).filter(Boolean))] };
    }
    save.mutate(reg, {
      onSuccess: () => toast({ title: "PROGRAMMES SAVED", description: "Programme registry updated." }),
      onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Check each programme has a unique id.", variant: "destructive" }),
    });
  };

  return (
    <AdminSection icon={Boxes} title="Programmes" testId="programme-registry-admin">
        <p className="text-xs text-muted-foreground">
          A programme is a <strong>name</strong> plus the <strong>project instance IDs</strong> that belong to it.
          Membership is by the project's correlation GUID, so a programme can span projects across different
          backends. Add a project's <code>omniInstanceId</code> to include it.
        </p>

        <EditableRowTable
          rows={rows}
          rowKey={(_, i) => i}
          rowTestId={(_, i) => `programme-row-${i}`}
          rowClassName={(_, i) => (badRows.has(i) ? "bg-red-500/10" : undefined)}
          onRemove={(i) => setDraft(rows.filter((_, j) => j !== i))}
          removeLabel={(i) => `Remove programme ${i + 1}`}
          emptyText="No programmes — projects show standalone until you group them."
          columns={[
            { header: "Programme id", cell: (r, i) => <Input aria-label={`Programme ${i + 1} id`} value={r.id} onChange={(e) => set(i, { id: e.target.value })} className="h-8 font-mono" /> },
            { header: "Name", cell: (r, i) => <Input aria-label={`Programme ${i + 1} name`} value={r.name} onChange={(e) => set(i, { name: e.target.value })} className="h-8" /> },
            { header: "Project instance IDs (comma)", cell: (r, i) => <Input aria-label={`Programme ${i + 1} instance ids`} value={r.guids} onChange={(e) => set(i, { guids: e.target.value })} className="h-8 font-mono" /> },
          ]}
        />

        <div className="flex items-center gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setDraft([...rows, empty()])} data-testid="programme-add">Add programme</Button>
          {dirty && <Button type="button" variant="ghost" size="sm" onClick={reset}>Reset</Button>}
          <Button type="button" size="sm" onClick={onSave} disabled={!dirty || badRows.size > 0 || save.isPending} data-testid="programme-save">
            {save.isPending ? "SAVING…" : "Save programmes"}
          </Button>
        </div>
    </AdminSection>
  );
}
