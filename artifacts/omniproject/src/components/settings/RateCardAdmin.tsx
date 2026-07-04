import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useRateCard, useSaveRateCard, type RateCardConfig, type ProjectType, type ValueColumn } from "../../lib/rate-card";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { PercentInput } from "./PercentInput";

/**
 * PMO rate-card authoring — project types + their value model, and the central cost-model defaults
 * (margin / overhead). Rates and identities live on dedicated screens; this is the structure they hang
 * off. Edits are staged in a local draft and persisted on Save (the PUT replaces the stored card, so the
 * untouched titles + rates are round-tripped verbatim). PMO-gated, mirroring the server.
 */

export function RateCardAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = useRateCard();
  const save = useSaveRateCard();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<RateCardConfig, RateCardConfig>(server, structuredClone);

  if (!roleAtLeast(auth?.role, "pmo")) return null;
  if (!draft) return null;

  const types = draft.projectTypes;
  const setTypes = (next: ProjectType[]) => setDraft({ ...draft, projectTypes: next });
  const patchType = (i: number, patch: Partial<ProjectType>) => setTypes(types.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  function addType() {
    const n = types.length + 1;
    setTypes([...types, { id: `type-${n}`, label: `Project type ${n}` }]);
  }
  function addColumn(i: number) {
    const cols = types[i]!.values ?? [];
    patchType(i, { values: [...cols, { id: `col-${cols.length + 1}`, label: "Value", kind: "cost" }] });
  }
  function patchColumn(ti: number, ci: number, patch: Partial<ValueColumn>) {
    const cols = (types[ti]!.values ?? []).map((c, j) => (j === ci ? { ...c, ...patch } : c));
    patchType(ti, { values: cols });
  }
  function removeColumn(ti: number, ci: number) {
    patchType(ti, { values: (types[ti]!.values ?? []).filter((_, j) => j !== ci) });
  }
  // Set/clear one field of a charge column's optional uplift, omitting cleared fields entirely
  // (exactOptionalPropertyTypes forbids an explicit `undefined`).
  function setColumnUplift(ti: number, ci: number, field: "margin" | "overhead", v: number | undefined) {
    const cur = types[ti]!.values![ci]!.uplift ?? {};
    const next: ValueColumn["uplift"] = {};
    if (field !== "margin" && cur.margin !== undefined) next.margin = cur.margin;
    if (field !== "overhead" && cur.overhead !== undefined) next.overhead = cur.overhead;
    if (v !== undefined) next[field] = v;
    patchColumn(ti, ci, { uplift: next });
  }

  function onSave() {
    save.mutate({
      titles: draft!.titles,
      rates: draft!.rates,
      projectTypes: draft!.projectTypes,
      uplift: draft!.uplift.central,
    });
  }

  return (
    <section className="space-y-4" data-testid="rate-card-admin">
      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Rate card — project types &amp; cost model</h2>
        <p className="text-xs text-muted-foreground">
          Define the project types rates are keyed by, the value columns each type reports, and the central
          margin / overhead used to derive cost-to-customer. Rates and identities have their own screens.
        </p>
      </div>

      {/* Central cost-model defaults. */}
      <div className="border-2 border-foreground p-3 space-y-2" data-testid="rate-card-central">
        <p className="text-xs font-bold uppercase tracking-wider">Cost-model defaults (central)</p>
        <p className="text-[11px] text-muted-foreground">Charge = cost × (1 + overhead + margin) on client-facing time. Overridable per programme/project.</p>
        <div className="flex flex-wrap gap-4">
          <PercentInput label="Margin" ariaLabel="Central margin %" value={draft.uplift.central.margin}
            onChange={(v) => setDraft({ ...draft, uplift: { ...draft.uplift, central: { ...draft.uplift.central, margin: v ?? 0 } } })} />
          <PercentInput label="Overhead" ariaLabel="Central overhead %" value={draft.uplift.central.overhead}
            onChange={(v) => setDraft({ ...draft, uplift: { ...draft.uplift, central: { ...draft.uplift.central, overhead: v ?? 0 } } })} />
        </div>
      </div>

      {/* Project types + per-type value columns. */}
      <div className="space-y-3">
        {types.length === 0 && (
          <p className="text-xs text-muted-foreground border border-dashed border-border p-4" data-testid="rate-card-no-types">
            No project types yet. Add one — rates and value columns are keyed by type.
          </p>
        )}
        {types.map((t, i) => (
          <div key={i} className="border-2 border-foreground p-3 space-y-2" data-testid={`rate-card-type-${i}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label={`Project type ${i + 1} id`} placeholder="id" className="w-32 rounded-none border-2 border-foreground font-mono text-xs"
                value={t.id} onChange={(e) => patchType(i, { id: e.target.value })} />
              <Input aria-label={`Project type ${i + 1} label`} placeholder="Label" className="flex-1 min-w-40 rounded-none border-2 border-foreground"
                value={t.label} onChange={(e) => patchType(i, { label: e.target.value })} />
              <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs"
                onClick={() => setTypes(types.filter((_, j) => j !== i))}>Remove type</Button>
            </div>

            <div className="pl-2 border-l-2 border-border space-y-1.5">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Value columns {t.values?.length ? "" : "(default: true cost + cost to customer)"}</p>
              {(t.values ?? []).map((c, ci) => (
                <div key={ci} className="flex flex-wrap items-center gap-2" data-testid={`rate-card-col-${i}-${ci}`}>
                  <Input aria-label={`Type ${i + 1} column ${ci + 1} id`} placeholder="id" className="w-24 rounded-none border border-border font-mono text-xs"
                    value={c.id} onChange={(e) => patchColumn(i, ci, { id: e.target.value })} />
                  <Input aria-label={`Type ${i + 1} column ${ci + 1} label`} placeholder="Label" className="w-40 rounded-none border border-border"
                    value={c.label} onChange={(e) => patchColumn(i, ci, { label: e.target.value })} />
                  <label className="text-xs flex items-center gap-1">
                    <span className="sr-only">{`Type ${i + 1} column ${ci + 1} kind`}</span>
                    <select aria-label={`Type ${i + 1} column ${ci + 1} kind`} className="rounded-none border border-border bg-background px-1 py-1 text-xs"
                      value={c.kind} onChange={(e) => patchColumn(i, ci, { kind: e.target.value as ValueColumn["kind"] })}>
                      <option value="cost">cost</option>
                      <option value="charge">charge</option>
                    </select>
                  </label>
                  {c.kind === "charge" && (
                    <>
                      <PercentInput label="margin" ariaLabel={`Type ${i + 1} column ${ci + 1} margin %`} value={c.uplift?.margin}
                        onChange={(v) => setColumnUplift(i, ci, "margin", v)} />
                      <PercentInput label="o/h" ariaLabel={`Type ${i + 1} column ${ci + 1} overhead %`} value={c.uplift?.overhead}
                        onChange={(v) => setColumnUplift(i, ci, "overhead", v)} />
                    </>
                  )}
                  <Button variant="ghost" className="rounded-none text-xs px-2" aria-label={`Remove column ${ci + 1} from type ${i + 1}`}
                    onClick={() => removeColumn(i, ci)}>✕</Button>
                </div>
              ))}
              <Button variant="outline" className="rounded-none border border-border text-xs" onClick={() => addColumn(i)}>+ value column</Button>
            </div>
          </div>
        ))}
        <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs" onClick={addType}>+ project type</Button>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button className="rounded-none border-2 border-foreground font-bold uppercase tracking-wider" onClick={onSave} disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save rate card"}
        </Button>
        {dirty && <Button variant="ghost" className="rounded-none text-xs" onClick={reset}>Reset</Button>}
        {save.isError && <span role="alert" className="text-xs font-bold text-red-500">{(save.error as Error).message}</span>}
        {save.isSuccess && !dirty && <span className="text-xs text-muted-foreground">Saved.</span>}
      </div>
    </section>
  );
}
