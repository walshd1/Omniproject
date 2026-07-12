import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SquarePlus } from "lucide-react";
import { CANONICAL_FIELD_KEYS } from "@workspace/backend-catalogue";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { useToast } from "@/hooks/use-toast";
import { useCustomFields, useSaveCustomFields, CUSTOM_FIELD_TYPES, type CustomField, type CustomFieldType } from "../../lib/custom-fields";

const empty = (): CustomField => ({ key: "", label: "", type: "string" });
const CANONICAL = new Set<string>([...CANONICAL_FIELD_KEYS]);

/**
 * Custom fields — EXTEND the reference superset with fields an org needs that aren't in the catalogue.
 * Definitions persist in settings (sealed at rest). Each field must have a source: map it in the
 * Routing Matrix, or run the built-in backend (which stores it) — the server enforces this, so a
 * field with no source can't be saved. Renaming a field's UI label is a separate concern (Labels).
 */
export function CustomFieldsAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = useCustomFields();
  const save = useSaveCustomFields();
  const { toast } = useToast();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<CustomField[], CustomField[]>(server, structuredClone);

  if (!roleAtLeast(auth?.role, "admin")) return null;

  const rows = draft ?? [];
  const set = (i: number, patch: Partial<CustomField>) => setDraft(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // Local shape feedback (the server is authoritative, incl. the source rule).
  const badRows = new Set<number>();
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const k = r.key.trim();
    if (!k || !r.label.trim() || CANONICAL.has(k) || seen.has(k)) badRows.add(i);
    if (k) seen.add(k);
  });

  const onSave = () => {
    save.mutate(rows.map((r) => ({ ...r, key: r.key.trim(), label: r.label.trim() })), {
      onSuccess: () => toast({ title: "CUSTOM FIELDS SAVED", description: "The superset was extended." }),
      onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Map each field or enable the built-in backend.", variant: "destructive" }),
    });
  };

  return (
    <section data-testid="custom-fields-admin">
      <div className="flex items-center gap-3 mb-4">
        <SquarePlus className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Custom fields (extend the superset)</h2>
      </div>
      <div className="bg-card border border-border p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Add a field the catalogue doesn't have. Each must have a source: <strong>map it in the Routing Matrix</strong>,
          or run the <strong>built-in backend</strong> (it stores unmapped fields). A field with no source can't be saved.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-muted-foreground uppercase tracking-wider">
                <th className="p-1 font-bold">Key</th>
                <th className="p-1 font-bold">Label</th>
                <th className="p-1 font-bold">Type</th>
                <th className="p-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={badRows.has(i) ? "bg-red-500/10" : undefined} data-testid={`custom-field-row-${i}`}>
                  <td className="p-1"><Input aria-label={`Field ${i + 1} key`} value={r.key} onChange={(e) => set(i, { key: e.target.value })} className="h-8 font-mono" /></td>
                  <td className="p-1"><Input aria-label={`Field ${i + 1} label`} value={r.label} onChange={(e) => set(i, { label: e.target.value })} className="h-8" /></td>
                  <td className="p-1">
                    <select aria-label={`Field ${i + 1} type`} value={r.type} onChange={(e) => set(i, { type: e.target.value as CustomFieldType })} className="h-8 bg-background border border-border text-xs px-2">
                      {CUSTOM_FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="p-1">
                    <button type="button" aria-label={`Remove field ${i + 1}`} onClick={() => setDraft(rows.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-red-500 px-2">×</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="p-3 text-center text-muted-foreground">No custom fields — the reference superset is used as-is.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setDraft([...rows, empty()])} data-testid="custom-field-add">Add field</Button>
          {dirty && <Button type="button" variant="ghost" size="sm" onClick={reset}>Reset</Button>}
          <Button type="button" size="sm" onClick={onSave} disabled={!dirty || badRows.size > 0 || save.isPending} data-testid="custom-field-save">
            {save.isPending ? "SAVING…" : "Save fields"}
          </Button>
        </div>
      </div>
    </section>
  );
}
