import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SquarePlus } from "lucide-react";
import { AdminSection } from "./AdminSection";
import { CANONICAL_FIELD_KEYS } from "@workspace/backend-catalogue";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { useToast } from "@/hooks/use-toast";
import { useCustomFields, useSaveCustomFields, CUSTOM_FIELD_TYPES, type CustomField, type CustomFieldType } from "../../lib/custom-fields";
import { EditableRowTable } from "./EditableRowTable";

const empty = (): CustomField => ({ key: "", label: "", type: "string" });
const CANONICAL = new Set<string>([...CANONICAL_FIELD_KEYS]);

/**
 * Custom fields — EXTEND the reference superset with fields an org needs that aren't in the catalogue.
 * Definitions persist in settings (sealed at rest). Each field must have a source: map it in the
 * Routing Matrix — route it to the Postgres backend if there's no external source. The server enforces
 * this, so a field with no route can't be saved. Renaming a field's UI label is a separate concern (Labels).
 */
export function CustomFieldsAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = useCustomFields();
  const save = useSaveCustomFields();
  const { toast } = useToast();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<CustomField[], CustomField[]>(server);

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
      onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Map each field in the routing matrix (route it to Postgres if there's no external source).", variant: "destructive" }),
    });
  };

  return (
    <AdminSection icon={SquarePlus} title="Custom fields (extend the superset)" testId="custom-fields-admin">
        <p className="text-xs text-muted-foreground">
          Add a field the catalogue doesn't have. Each must have a source: <strong>map it in the Routing Matrix</strong>.
          If no external system carries it, route it to the <strong>Postgres backend</strong> (a backend like any other).
          A field with no route can't be saved.
        </p>

        <EditableRowTable
          rows={rows}
          rowKey={(_, i) => i}
          rowTestId={(_, i) => `custom-field-row-${i}`}
          rowClassName={(_, i) => (badRows.has(i) ? "bg-red-500/10" : undefined)}
          onRemove={(i) => setDraft(rows.filter((_, j) => j !== i))}
          removeLabel={(i) => `Remove field ${i + 1}`}
          emptyText="No custom fields — the reference superset is used as-is."
          columns={[
            { header: "Key", cell: (r, i) => <Input aria-label={`Field ${i + 1} key`} value={r.key} onChange={(e) => set(i, { key: e.target.value })} className="h-8 font-mono" /> },
            { header: "Label", cell: (r, i) => <Input aria-label={`Field ${i + 1} label`} value={r.label} onChange={(e) => set(i, { label: e.target.value })} className="h-8" /> },
            { header: "Type", cell: (r, i) => (
              <select aria-label={`Field ${i + 1} type`} value={r.type} onChange={(e) => set(i, { type: e.target.value as CustomFieldType })} className="h-8 bg-background border border-border text-xs px-2">
                {CUSTOM_FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            ) },
          ]}
        />

        <div className="flex items-center gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setDraft([...rows, empty()])} data-testid="custom-field-add">Add field</Button>
          {dirty && <Button type="button" variant="ghost" size="sm" onClick={reset}>Reset</Button>}
          <Button type="button" size="sm" onClick={onSave} disabled={!dirty || badRows.size > 0 || save.isPending} data-testid="custom-field-save">
            {save.isPending ? "SAVING…" : "Save fields"}
          </Button>
        </div>
    </AdminSection>
  );
}
