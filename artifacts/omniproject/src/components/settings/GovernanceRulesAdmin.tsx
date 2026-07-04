import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useFeatures, useGovernanceRules, useSaveGovernanceRules, GOVERNANCE_RULE_FIELDS, type GovernanceRule, type FeatureStatus } from "../../lib/features";
import type { Predicate } from "../../lib/rate-card";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { PredicateEditor } from "./PredicateEditor";

/**
 * PMO conditional-governance editor — "when → require / forbid / disable" rules over the catalogue
 * (modules, reports, methodologies). When a rule's predicate matches a scope it adds that restriction at
 * the org level, so it can only narrow — never grant beyond the org. Predicate fields are restricted to
 * the synchronously-evaluable facts (programme / project / project type) so the rule resolves the same
 * when the UI reads status and when the gateway enforces. PMO-gated, mirroring the server.
 */

type Effect = "require" | "forbid" | "disable";
const EFFECTS: Effect[] = ["require", "forbid", "disable"];

/** Read the selected ids out of a multi-select change event. */
function selectedIds(e: React.ChangeEvent<HTMLSelectElement>): string[] {
  return Array.from(e.target.selectedOptions, (o) => o.value);
}

export function GovernanceRulesAdmin() {
  const { data: auth } = useAuth();
  const { data: rules } = useGovernanceRules();
  const { data: features } = useFeatures();
  const save = useSaveGovernanceRules();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<GovernanceRule[], GovernanceRule[]>(rules, structuredClone);

  if (!roleAtLeast(auth?.role, "pmo")) return null;
  if (!draft || !features) return null;

  // Only governable catalogue items (modules + reports + methodologies) can be required/forbidden/disabled.
  const catalogue: FeatureStatus[] = features;
  const patch = (i: number, r: GovernanceRule) => setDraft(draft.map((x, j) => (j === i ? r : x)));

  return (
    <section className="space-y-3" data-testid="governance-rules-admin">
      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Governance rules (conditional)</h2>
        <p className="text-xs text-muted-foreground">
          Apply a mandate only when a condition holds — e.g. “forbid the EVM report on internal projects”.
          Rules can only restrict (a small internal project gets lighter control); they never loosen the org
          grant. Conditions use project / programme / type only.
        </p>
      </div>

      {draft.length === 0 && (
        <p className="text-xs text-muted-foreground border border-dashed border-border p-4" data-testid="governance-rules-empty">No conditional rules — the org / programme / project governance applies as set.</p>
      )}

      {draft.map((r, i) => (
        <div key={i} className="border-2 border-foreground p-3 space-y-2" data-testid={`governance-rule-${i}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label={`Governance rule ${i + 1} id`} placeholder="id" className="w-36 rounded-none border-2 border-foreground font-mono text-xs"
              value={r.id} onChange={(e) => patch(i, { ...r, id: e.target.value })} />
            <Input aria-label={`Governance rule ${i + 1} label`} placeholder="Label (optional)" className="flex-1 min-w-40 rounded-none border-2 border-foreground"
              value={r.label ?? ""} onChange={(e) => patch(i, { ...r, label: e.target.value })} />
            <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs"
              onClick={() => setDraft(draft.filter((_, j) => j !== i))}>Remove</Button>
          </div>

          <div className="pl-2 border-l-2 border-border">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">When (all of)</p>
            <PredicateEditor idPrefix={`gov-${i}`} fieldOptions={GOVERNANCE_RULE_FIELDS}
              value={r.when?.all ?? []}
              onChange={(preds: Predicate[]) => { const { when: _drop, ...rest } = r; patch(i, preds.length ? { ...rest, when: { all: preds } } : rest); }} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pl-2">
            {EFFECTS.map((eff) => (
              <label key={eff} className="text-xs space-y-1">
                <span className="block text-[10px] uppercase tracking-widest text-muted-foreground">Then {eff}</span>
                <select multiple aria-label={`Governance rule ${i + 1} ${eff} items`} className="w-full h-28 rounded-none border border-border bg-background p-1 text-xs"
                  value={r[eff] ?? []}
                  onChange={(e) => { const ids = selectedIds(e); const { [eff]: _drop, ...rest } = r; patch(i, ids.length ? { ...rest, [eff]: ids } : rest); }}>
                  {catalogue.map((f) => <option key={f.id} value={f.id}>{f.label} ({f.kind})</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs"
          onClick={() => setDraft([...draft, { id: `gov-rule-${draft.length + 1}` }])}>+ governance rule</Button>
        <Button className="rounded-none border-2 border-foreground font-bold uppercase tracking-wider"
          onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save governance rules"}
        </Button>
        {dirty && <Button variant="ghost" className="rounded-none text-xs" onClick={reset}>Reset</Button>}
        {save.isError && <span role="alert" className="text-xs font-bold text-red-500">{(save.error as Error).message}</span>}
      </div>
    </section>
  );
}
