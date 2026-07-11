import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useCostRules, useSaveCostRules, type CostRule, type Predicate } from "../../lib/rate-card";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { useRowKeys } from "../../hooks/use-row-keys";
import { PercentInput } from "./PercentInput";
import { PredicateEditor } from "./PredicateEditor";

/**
 * PMO cost-rule editor — general "when → margin/overhead" rules. When a rule's predicate matches a
 * project's context (programme, type, budget, a custom flag like intra-company, …) its margin/overhead
 * override the scope-resolved uplift. Rules are fully general: the "intra-company" example is just one
 * predicate, never special-cased. PMO-gated, mirroring the server; saved as the full rule list.
 */

/** Read a rule's `when.all` predicates (the editor authors the AND list). */
const predsOf = (r: CostRule): Predicate[] => r.when?.all ?? [];

/** Fold an edited predicate list back into a rule, dropping an empty `when` entirely. */
function withPreds(r: CostRule, preds: Predicate[]): CostRule {
  const { when: _drop, ...rest } = r;
  return preds.length ? { ...rest, when: { all: preds } } : rest;
}

export function CostRulesAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = useCostRules();
  const save = useSaveCostRules();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<CostRule[], CostRule[]>(server, structuredClone);
  // Stable keys held alongside the draft (never inside it — see use-row-keys); called before the
  // early returns to keep the hook order stable.
  const rowKeys = useRowKeys(draft?.length ?? 0);

  if (!roleAtLeast(auth?.role, "pmo")) return null;
  if (!draft) return null;

  const patch = (i: number, r: CostRule) => setDraft(draft.map((x, j) => (j === i ? r : x)));
  const removeRule = (i: number) => { rowKeys.removeAt(i); setDraft(draft.filter((_, j) => j !== i)); };

  // Set or clear one effect field, omitting a cleared field entirely (exactOptionalPropertyTypes).
  function setEffect(i: number, field: "margin" | "overhead", v: number | undefined) {
    const r = draft![i]!;
    const effect: CostRule["effect"] = {};
    if (field !== "margin" && r.effect.margin !== undefined) effect.margin = r.effect.margin;
    if (field !== "overhead" && r.effect.overhead !== undefined) effect.overhead = r.effect.overhead;
    if (v !== undefined) effect[field] = v;
    patch(i, { ...r, effect });
  }

  function addRule() {
    setDraft([...draft!, { id: `cost-rule-${draft!.length + 1}`, effect: {} }]);
  }

  return (
    <section className="space-y-3" data-testid="cost-rules-admin">
      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Cost rules</h2>
        <p className="text-xs text-muted-foreground">
          Override margin / overhead when a condition holds — e.g. “overhead 0% when intraCompany is true”.
          A rule with no conditions always applies; later matching rules win per field.
        </p>
      </div>

      {draft.length === 0 && (
        <p className="text-xs text-muted-foreground border border-dashed border-border p-4" data-testid="cost-rules-empty">No cost rules — the scope-resolved uplift applies everywhere.</p>
      )}

      {draft.map((r, i) => (
        <div key={rowKeys.keyAt(i)} className="border-2 border-foreground p-3 space-y-2" data-testid={`cost-rule-${i}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label={`Cost rule ${i + 1} id`} placeholder="id" className="w-36 rounded-none border-2 border-foreground font-mono text-xs"
              value={r.id} onChange={(e) => patch(i, { ...r, id: e.target.value })} />
            <Input aria-label={`Cost rule ${i + 1} label`} placeholder="Label (optional)" className="flex-1 min-w-40 rounded-none border-2 border-foreground"
              value={r.label ?? ""} onChange={(e) => patch(i, { ...r, label: e.target.value })} />
            <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs"
              onClick={() => removeRule(i)}>Remove</Button>
          </div>

          <div className="pl-2 border-l-2 border-border">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">When (all of)</p>
            <PredicateEditor idPrefix={`cost-${i}`} value={predsOf(r)} onChange={(preds) => patch(i, withPreds(r, preds))} />
          </div>

          <div className="flex flex-wrap items-center gap-4 pl-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Then set</span>
            <PercentInput label="Margin" ariaLabel={`Cost rule ${i + 1} margin %`} value={r.effect.margin}
              onChange={(v) => setEffect(i, "margin", v)} />
            <PercentInput label="Overhead" ariaLabel={`Cost rule ${i + 1} overhead %`} value={r.effect.overhead}
              onChange={(v) => setEffect(i, "overhead", v)} />
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs" onClick={addRule}>+ cost rule</Button>
        <Button className="rounded-none border-2 border-foreground font-bold uppercase tracking-wider"
          onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save cost rules"}
        </Button>
        {dirty && <Button variant="ghost" className="rounded-none text-xs" onClick={reset}>Reset</Button>}
        {save.isError && <span role="alert" className="text-xs font-bold text-red-500">{(save.error as Error).message}</span>}
      </div>
    </section>
  );
}
