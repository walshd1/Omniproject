import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Waypoints } from "lucide-react";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { useToast } from "@/hooks/use-toast";
import { useFieldRouting, useSaveFieldRouting, routingCollisions, type FieldRoute } from "../../lib/routing";
import { usePickableFields } from "../../lib/pickable-fields";
import { EditableRowTable } from "./EditableRowTable";

const empty = (): FieldRoute => ({ uiElement: "", vendor: "", broker: "", sourceField: "" });

/**
 * The field-routing matrix (admin): map each UI element to exactly one source — a
 * vendor·broker·sourceField. The anti-collision invariant ("one source → one UI element, both ways")
 * is highlighted live here and enforced authoritatively by the server (a colliding save is a 400).
 * Presentation/label renaming is a SEPARATE concern (the nomenclature/Labels panel).
 */
export function RoutingMatrix() {
  const { data: auth } = useAuth();
  const { data: server } = useFieldRouting();
  const pickable = usePickableFields();
  const save = useSaveFieldRouting();
  const { toast } = useToast();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<FieldRoute[], FieldRoute[]>(server, structuredClone);

  // Admin-only: routing decides where every value comes from.
  if (!roleAtLeast(auth?.role, "admin")) return null;

  // UI elements you can route: what wired backends advertise (∪ already-mapped ∪ custom), not the raw
  // superset. Going beyond the advertised set is a deliberate act (wire a backend/broker, or Postgres).
  const uiElements = pickable.fields;
  const rows = draft ?? [];
  const collisions = routingCollisions(rows);
  const setRow = (i: number, patch: Partial<FieldRoute>) => setDraft(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const onSave = () => {
    save.mutate(rows.filter((r) => r.uiElement && r.vendor && r.broker && r.sourceField), {
      onSuccess: () => toast({ title: "ROUTING SAVED", description: "Field routing updated." }),
      onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Check for collisions.", variant: "destructive" }),
    });
  };

  return (
    <section data-testid="routing-matrix">
      <div className="flex items-center gap-3 mb-4">
        <Waypoints className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Field routing matrix</h2>
      </div>
      <div className="bg-card border border-border p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Map each <strong>UI element</strong> to exactly one source — a <strong>vendor · broker · source field</strong>.
          One source may feed one UI element at a time (both directions); a collision is blocked.
        </p>

        {pickable.restricted ? (
          <p className="text-xs text-muted-foreground" data-testid="routing-state">
            Showing the <strong>{pickable.advertised.length}</strong> field(s) your wired backends advertise
            {pickable.custom.length > 0 && <> plus <strong>{pickable.custom.length}</strong> custom field(s)</>}.
            To go beyond, wire up another backend/broker — or enable the Postgres sidecar (a deliberate extension).
          </p>
        ) : (
          <p className="text-xs text-muted-foreground" data-testid="routing-state">
            No live backend is advertising fields yet, so the full reference superset is offered. Wire a backend
            through a broker to narrow this to what's actually available.
          </p>
        )}

        <datalist id="routing-ui-elements">
          {uiElements.map((k) => <option key={k} value={k} />)}
        </datalist>

        <EditableRowTable
          rows={rows}
          rowKey={(_, i) => i}
          rowTestId={(_, i) => `routing-row-${i}`}
          rowClassName={(_, i) => (collisions.has(i) ? "bg-red-500/10" : undefined)}
          onRemove={(i) => setDraft(rows.filter((_, j) => j !== i))}
          removeLabel={(i) => `Remove row ${i + 1}`}
          emptyText="No routes yet — add one to source a UI element from a specific vendor + broker."
          columns={[
            { header: "UI element", cell: (r, i) => <Input list="routing-ui-elements" aria-label={`Row ${i + 1} UI element`} value={r.uiElement} onChange={(e) => setRow(i, { uiElement: e.target.value })} className="h-8" /> },
            { header: "Vendor", cell: (r, i) => <Input aria-label={`Row ${i + 1} vendor`} value={r.vendor} onChange={(e) => setRow(i, { vendor: e.target.value })} className="h-8" /> },
            { header: "Broker", cell: (r, i) => <Input aria-label={`Row ${i + 1} broker`} value={r.broker} onChange={(e) => setRow(i, { broker: e.target.value })} className="h-8" /> },
            { header: "Source field", cell: (r, i) => <Input aria-label={`Row ${i + 1} source field`} value={r.sourceField} onChange={(e) => setRow(i, { sourceField: e.target.value })} className="h-8 font-mono" /> },
          ]}
        />

        {collisions.size > 0 && (
          <p role="alert" className="text-xs font-bold text-red-500" data-testid="routing-collision">
            Collision: a UI element or a vendor·broker·source-field source is used more than once. Each must be unique.
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setDraft([...rows, empty()])} data-testid="routing-add">Add route</Button>
          {dirty && <Button type="button" variant="ghost" size="sm" onClick={reset}>Reset</Button>}
          <Button type="button" size="sm" onClick={onSave} disabled={!dirty || collisions.size > 0 || save.isPending} data-testid="routing-save">
            {save.isPending ? "SAVING…" : "Save routing"}
          </Button>
        </div>
      </div>
    </section>
  );
}
