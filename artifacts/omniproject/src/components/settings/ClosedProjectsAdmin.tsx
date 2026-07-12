import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Archive } from "lucide-react";
import { useAuth, isPmoOrAdmin } from "../../lib/auth";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { useToast } from "@/hooks/use-toast";
import { useClosedProjects, useSaveClosedProjects, PROJECT_DISPOSITIONS, type ClosedProjectRegistry, type ProjectDisposition } from "../../lib/closed-projects";

interface Row { guid: string; disposition: ProjectDisposition; source: string; note: string }
const empty = (): Row => ({ guid: "", disposition: "sor", source: "", note: "" });
const toRows = (reg: ClosedProjectRegistry): Row[] =>
  Object.entries(reg).map(([guid, r]) => ({ guid, disposition: r.disposition, source: r.source ?? "", note: r.note ?? "" }));

/**
 * Closed projects (admin/PMO) — the location index for projects that have closed. Each row records a
 * project GUID and where its data now lives: left in the current backend (SOR), or migrated to the
 * self-managed archive. Reports resolve their source GUIDs against this to pull closed data without
 * re-pulling everything through the live broker. Sealed at rest.
 */
export function ClosedProjectsAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = useClosedProjects();
  const save = useSaveClosedProjects();
  const { toast } = useToast();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<ClosedProjectRegistry, Row[]>(server, toRows);

  if (!isPmoOrAdmin(auth?.role)) return null;

  const rows = draft ?? [];
  const set = (i: number, patch: Partial<Row>) => setDraft(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // A closed-project entry needs a unique, non-empty GUID.
  const badRows = new Set<number>();
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const g = r.guid.trim();
    if (!g || seen.has(g)) badRows.add(i);
    if (g) seen.add(g);
  });

  const onSave = () => {
    const reg: ClosedProjectRegistry = {};
    for (const r of rows) {
      const guid = r.guid.trim();
      if (!guid) continue;
      reg[guid] = { disposition: r.disposition, ...(r.source.trim() ? { source: r.source.trim() } : {}), ...(r.note.trim() ? { note: r.note.trim() } : {}) };
    }
    save.mutate(reg, {
      onSuccess: () => toast({ title: "CLOSED PROJECTS SAVED", description: "Location index updated." }),
      onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Each entry needs a unique GUID.", variant: "destructive" }),
    });
  };

  return (
    <section data-testid="closed-projects-admin">
      <div className="flex items-center gap-3 mb-4">
        <Archive className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Closed projects</h2>
      </div>
      <div className="bg-card border border-border p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Where a closed project's data lives, by GUID. <strong>SOR</strong> leaves it in the originating
          backend (pulled on demand); <strong>Archive</strong> marks it migrated to the self-managed
          archive. The live broker never re-pulls closed projects — reports resolve their GUIDs here.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-muted-foreground uppercase tracking-wider">
                <th className="p-1 font-bold">Project GUID</th>
                <th className="p-1 font-bold">Disposition</th>
                <th className="p-1 font-bold">Source</th>
                <th className="p-1 font-bold">Note</th>
                <th className="p-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={badRows.has(i) ? "bg-red-500/10" : undefined} data-testid={`closed-project-row-${i}`}>
                  <td className="p-1"><Input aria-label={`Closed project ${i + 1} guid`} value={r.guid} onChange={(e) => set(i, { guid: e.target.value })} className="h-8 font-mono" /></td>
                  <td className="p-1">
                    <select aria-label={`Closed project ${i + 1} disposition`} value={r.disposition} onChange={(e) => set(i, { disposition: e.target.value as ProjectDisposition })} className="h-8 bg-background border border-border text-xs px-2">
                      {PROJECT_DISPOSITIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </td>
                  <td className="p-1"><Input aria-label={`Closed project ${i + 1} source`} value={r.source} onChange={(e) => set(i, { source: e.target.value })} className="h-8 font-mono" /></td>
                  <td className="p-1"><Input aria-label={`Closed project ${i + 1} note`} value={r.note} onChange={(e) => set(i, { note: e.target.value })} className="h-8" /></td>
                  <td className="p-1">
                    <button type="button" aria-label={`Remove closed project ${i + 1}`} onClick={() => setDraft(rows.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-red-500 px-2">×</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="p-3 text-center text-muted-foreground">No closed projects recorded.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setDraft([...rows, empty()])} data-testid="closed-project-add">Add entry</Button>
          {dirty && <Button type="button" variant="ghost" size="sm" onClick={reset}>Reset</Button>}
          <Button type="button" size="sm" onClick={onSave} disabled={!dirty || badRows.size > 0 || save.isPending} data-testid="closed-project-save">
            {save.isPending ? "SAVING…" : "Save closed projects"}
          </Button>
        </div>
      </div>
    </section>
  );
}
