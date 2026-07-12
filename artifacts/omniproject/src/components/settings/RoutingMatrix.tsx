import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Waypoints } from "lucide-react";
import { CANONICAL_FIELD_KEYS } from "@workspace/backend-catalogue";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { useToast } from "@/hooks/use-toast";
import { useFieldRouting, useSaveFieldRouting, routingCollisions, type FieldRoute } from "../../lib/routing";
import { useCustomFields } from "../../lib/custom-fields";

const CANONICAL_ELEMENTS = [...CANONICAL_FIELD_KEYS].sort();
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
  const { data: customFields } = useCustomFields();
  const save = useSaveFieldRouting();
  const { toast } = useToast();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<FieldRoute[], FieldRoute[]>(server, structuredClone);

  // Admin-only: routing decides where every value comes from.
  if (!roleAtLeast(auth?.role, "admin")) return null;

  // UI elements you can route: the reference superset PLUS any admin-defined custom fields.
  const uiElements = [...CANONICAL_ELEMENTS, ...(customFields ?? []).map((f) => f.key)];
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

        <datalist id="routing-ui-elements">
          {uiElements.map((k) => <option key={k} value={k} />)}
        </datalist>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-muted-foreground uppercase tracking-wider">
                <th className="p-1 font-bold">UI element</th>
                <th className="p-1 font-bold">Vendor</th>
                <th className="p-1 font-bold">Broker</th>
                <th className="p-1 font-bold">Source field</th>
                <th className="p-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={collisions.has(i) ? "bg-red-500/10" : undefined} data-testid={`routing-row-${i}`}>
                  <td className="p-1">
                    <Input list="routing-ui-elements" aria-label={`Row ${i + 1} UI element`} value={r.uiElement} onChange={(e) => setRow(i, { uiElement: e.target.value })} className="h-8" />
                  </td>
                  <td className="p-1"><Input aria-label={`Row ${i + 1} vendor`} value={r.vendor} onChange={(e) => setRow(i, { vendor: e.target.value })} className="h-8" /></td>
                  <td className="p-1"><Input aria-label={`Row ${i + 1} broker`} value={r.broker} onChange={(e) => setRow(i, { broker: e.target.value })} className="h-8" /></td>
                  <td className="p-1"><Input aria-label={`Row ${i + 1} source field`} value={r.sourceField} onChange={(e) => setRow(i, { sourceField: e.target.value })} className="h-8 font-mono" /></td>
                  <td className="p-1">
                    <button type="button" aria-label={`Remove row ${i + 1}`} onClick={() => setDraft(rows.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-red-500 px-2">×</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="p-3 text-center text-muted-foreground">No routes yet — add one to source a UI element from a specific vendor + broker.</td></tr>
              )}
            </tbody>
          </table>
        </div>

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
