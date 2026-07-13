import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shuffle } from "lucide-react";
import { useAuth, isPmoOrAdmin } from "../../lib/auth";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { useToast } from "@/hooks/use-toast";
import { useGuidAliases, useSaveGuidAliases, useForgetProject, exportProjectReferences, type GuidAliases } from "../../lib/guid-aliases";

interface Row { oldGuid: string; newGuid: string }
const empty = (): Row => ({ oldGuid: "", newGuid: "" });
const toRows = (a: GuidAliases): Row[] => Object.entries(a).map(([oldGuid, newGuid]) => ({ oldGuid, newGuid }));

/**
 * Project GUIDs (admin/PMO) — GUID lifecycle management. RELINK: map an old correlation GUID to a new
 * one so historical references resolve after a project is re-created. FORGET: "delete" a project by
 * unlinking its GUID from every OmniProject list — the data (in the backend or the archive) is never
 * touched. Both are governance actions (PMO or admin).
 */
export function GuidAliasesAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = useGuidAliases();
  const save = useSaveGuidAliases();
  const forget = useForgetProject();
  const { toast } = useToast();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<GuidAliases, Row[]>(server, toRows);
  const [forgetGuid, setForgetGuid] = useState("");

  if (!isPmoOrAdmin(auth?.role)) return null;

  const rows = draft ?? [];
  const set = (i: number, patch: Partial<Row>) => setDraft(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // A relink needs both ends, they must differ, and no old GUID repeats.
  const badRows = new Set<number>();
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const o = r.oldGuid.trim();
    const n = r.newGuid.trim();
    if (!o || !n || o === n || seen.has(o)) badRows.add(i);
    if (o) seen.add(o);
  });

  const onSave = () => {
    const aliases: GuidAliases = {};
    for (const r of rows) {
      const o = r.oldGuid.trim();
      const n = r.newGuid.trim();
      if (o && n) aliases[o] = n;
    }
    save.mutate(aliases, {
      onSuccess: () => toast({ title: "RELINKS SAVED", description: "GUID translation updated." }),
      onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Check for self-links or cycles.", variant: "destructive" }),
    });
  };

  const [exporting, setExporting] = useState(false);
  const onExport = async () => {
    const g = forgetGuid.trim();
    if (!g) return;
    setExporting(true);
    try {
      await exportProjectReferences(g);
      toast({ title: "EXPORTED", description: "Project references downloaded — safe to forget." });
    } catch (e) {
      toast({ title: "COULD NOT EXPORT", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const onForget = () => {
    const g = forgetGuid.trim();
    if (!g) return;
    forget.mutate(g, {
      onSuccess: (r) => { setForgetGuid(""); toast({ title: "PROJECT FORGOTTEN", description: `Unlinked from ${r?.removedFromProgrammes?.length ?? 0} programme(s)${r?.removedFromClosed ? ", closed index" : ""}; GUID retired.` }); },
      onError: (e) => toast({ title: "COULD NOT FORGET", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
    });
  };

  return (
    <section data-testid="guid-aliases-admin">
      <div className="flex items-center gap-3 mb-4">
        <Shuffle className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Project GUIDs</h2>
      </div>
      <div className="bg-card border border-border p-4 space-y-4">
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            <strong>Relink</strong> — map an old project GUID to a new one so historical references
            (programmes, closed index, reports) resolve after a project is re-created.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-muted-foreground uppercase tracking-wider">
                  <th className="p-1 font-bold">Old GUID</th>
                  <th className="p-1 font-bold">→ New GUID</th>
                  <th className="p-1" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={badRows.has(i) ? "bg-red-500/10" : undefined} data-testid={`guid-alias-row-${i}`}>
                    <td className="p-1"><Input aria-label={`Alias ${i + 1} old`} value={r.oldGuid} onChange={(e) => set(i, { oldGuid: e.target.value })} className="h-8 font-mono" /></td>
                    <td className="p-1"><Input aria-label={`Alias ${i + 1} new`} value={r.newGuid} onChange={(e) => set(i, { newGuid: e.target.value })} className="h-8 font-mono" /></td>
                    <td className="p-1">
                      <button type="button" aria-label={`Remove alias ${i + 1}`} onClick={() => setDraft(rows.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-red-500 px-2">×</button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={3} className="p-3 text-center text-muted-foreground">No relinks.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setDraft([...rows, empty()])} data-testid="guid-alias-add">Add relink</Button>
            {dirty && <Button type="button" variant="ghost" size="sm" onClick={reset}>Reset</Button>}
            <Button type="button" size="sm" onClick={onSave} disabled={!dirty || badRows.size > 0 || save.isPending} data-testid="guid-alias-save">
              {save.isPending ? "SAVING…" : "Save relinks"}
            </Button>
          </div>
        </div>

        <div className="border-t border-border pt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            <strong>Forget a project</strong> — unlink a GUID from every OmniProject list (closed index,
            programmes, relinks) and <strong>retire</strong> it so it can't silently reactivate. The
            project's data in its backend or the archive is <strong>not</strong> touched. Export first if
            you want a record.
          </p>
          <div className="flex items-center gap-2">
            <Input aria-label="Forget project GUID" placeholder="project GUID" value={forgetGuid} onChange={(e) => setForgetGuid(e.target.value)} className="h-8 font-mono max-w-xs" data-testid="guid-forget-input" />
            <Button type="button" variant="outline" size="sm" onClick={onExport} disabled={!forgetGuid.trim() || exporting} data-testid="guid-export-btn">
              {exporting ? "…" : "Export"}
            </Button>
            <Button type="button" variant="destructive" size="sm" onClick={onForget} disabled={!forgetGuid.trim() || forget.isPending} data-testid="guid-forget-btn">
              {forget.isPending ? "…" : "Forget"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
