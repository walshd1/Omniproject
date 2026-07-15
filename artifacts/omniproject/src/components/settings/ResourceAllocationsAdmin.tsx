import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users } from "lucide-react";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { useToast } from "@/hooks/use-toast";
import { useResourceAllocations, useSaveResourceAllocations, type ResourceAllocation } from "../../lib/resource-allocations";
import { AdminSection } from "./AdminSection";
import { EditableRowTable } from "./EditableRowTable";

/**
 * Resource allocations (manager+) — the CONTENT editor behind the Resource-planning screen. A booking
 * commits a named person to a project for some hours over a period. This owns the data only; the screen
 * renders the roll-ups generically from the same rows. Separate admin panel (content) from the on-screen
 * layout editor (presentation), per the JSON-backed split.
 */
const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}/.test(s.trim());
const emptyAlloc = (n: number): ResourceAllocation => ({ id: `alloc-${n}`, resource: "", projectId: "", hours: 0, periodStart: "", periodEnd: "" });

export function ResourceAllocationsAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = useResourceAllocations();
  const save = useSaveResourceAllocations();
  const { toast } = useToast();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<ResourceAllocation[], ResourceAllocation[]>(server, structuredClone);

  if (!roleAtLeast(auth?.role, "manager")) return null;

  const rows = draft ?? [];
  const set = (i: number, patch: Partial<ResourceAllocation>) => setDraft(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // Validation mirrors the server validateResourceAllocations: id/resource/projectId required, ids unique,
  // hours a non-negative finite number, ISO period dates, end not before start.
  const badRows = new Set<number>();
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const id = r.id.trim();
    if (!id || !r.resource.trim() || !r.projectId.trim() || seen.has(id)) badRows.add(i);
    if (id) seen.add(id);
    if (!Number.isFinite(r.hours) || r.hours < 0) badRows.add(i);
    if (!isDay(r.periodStart) || !isDay(r.periodEnd)) badRows.add(i);
    else if (Date.parse(r.periodEnd) < Date.parse(r.periodStart)) badRows.add(i);
  });

  const onSave = () => {
    const cleaned: ResourceAllocation[] = rows.map((r) => ({
      id: r.id.trim(), resource: r.resource.trim(), projectId: r.projectId.trim(),
      hours: r.hours, periodStart: r.periodStart.trim(), periodEnd: r.periodEnd.trim(),
    }));
    save.mutate(cleaned, {
      onSuccess: () => toast({ title: "ALLOCATIONS SAVED", description: "Resource bookings updated." }),
      onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Check the bookings and try again.", variant: "destructive" }),
    });
  };

  return (
    <AdminSection icon={Users} title="Resource allocations" testId="resource-allocations-admin" bodyClassName="space-y-4">
      <p className="text-xs text-muted-foreground">
        Book a person onto a project for a number of hours over a period. The Resource-planning screen rolls
        these up (by resource / project) automatically.
      </p>

      {rows.length === 0 && <p className="text-xs text-muted-foreground" data-testid="resource-allocations-empty">No allocations yet.</p>}

      <EditableRowTable
        rows={rows}
        rowKey={(_, i) => i}
        rowTestId={(_, i) => `resource-alloc-row-${i}`}
        rowClassName={(_, i) => (badRows.has(i) ? "bg-red-500/10" : undefined)}
        onRemove={(i) => setDraft(rows.filter((_, j) => j !== i))}
        removeLabel={(i) => `Remove allocation ${i + 1}`}
        emptyText="No allocations."
        columns={[
          { header: "Resource", cell: (r, i) => <Input aria-label={`Allocation ${i + 1} resource`} placeholder="person" value={r.resource} onChange={(e) => set(i, { resource: e.target.value })} className="h-8 max-w-36" /> },
          { header: "Project", cell: (r, i) => <Input aria-label={`Allocation ${i + 1} project`} placeholder="project id" value={r.projectId} onChange={(e) => set(i, { projectId: e.target.value })} className="h-8 max-w-36 font-mono" /> },
          { header: "Hours", cell: (r, i) => <Input aria-label={`Allocation ${i + 1} hours`} type="number" value={Number.isFinite(r.hours) ? r.hours : ""} onChange={(e) => set(i, { hours: e.target.value === "" ? NaN : Number(e.target.value) })} className="h-8 max-w-24 tabular-nums" /> },
          { header: "Start", cell: (r, i) => <Input aria-label={`Allocation ${i + 1} start`} type="date" value={r.periodStart} onChange={(e) => set(i, { periodStart: e.target.value })} className="h-8 max-w-40" /> },
          { header: "End", cell: (r, i) => <Input aria-label={`Allocation ${i + 1} end`} type="date" value={r.periodEnd} onChange={(e) => set(i, { periodEnd: e.target.value })} className="h-8 max-w-40" /> },
        ]}
      />

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setDraft([...rows, emptyAlloc(rows.length + 1)])} data-testid="resource-alloc-add">Add allocation</Button>
        {dirty && <Button type="button" variant="ghost" size="sm" onClick={reset}>Reset</Button>}
        <Button type="button" size="sm" onClick={onSave} disabled={!dirty || badRows.size > 0 || save.isPending} data-testid="resource-allocations-save">
          {save.isPending ? "SAVING…" : "Save allocations"}
        </Button>
      </div>
    </AdminSection>
  );
}
