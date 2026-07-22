import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Wallet } from "lucide-react";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { useToast } from "@/hooks/use-toast";
import { useBudgetPlans, useSaveBudgetPlans, type BudgetPlan } from "../../lib/budget-plans";
import { AdminSection } from "./AdminSection";
import { EditableRowTable } from "./EditableRowTable";

/**
 * Budget plans (manager+) — the CONTENT editor behind the Budgets screen. A plan is a project's
 * time-phased planned budget in one currency; each plan carries a list of period → amount rows. This owns
 * the data only; the Budgets screen renders the roll-ups generically from the same JSON. Kept as a separate
 * admin panel (content) from the on-screen layout editor (presentation), per the JSON-backed split.
 */
const emptyPlan = (n: number): BudgetPlan => ({ id: `plan-${n}`, projectId: "", currency: "", periods: [] });

export function BudgetPlansAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = useBudgetPlans();
  const save = useSaveBudgetPlans();
  const { toast } = useToast();
  const { draft, setDraft, dirty, reset } = useDraftAdmin<BudgetPlan[], BudgetPlan[]>(server);

  if (!roleAtLeast(auth?.role, "manager")) return null;

  const plans = draft ?? [];
  const setPlan = (i: number, patch: Partial<BudgetPlan>) => setDraft(plans.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  // Validation: id + projectId required, ids unique; each period needs a label + finite amount; period
  // labels unique within a plan. Flagged rows disable Save (mirrors the server-side validateBudgetPlans).
  const badPlans = new Set<number>();
  const seenIds = new Set<string>();
  plans.forEach((p, i) => {
    const id = p.id.trim();
    if (!id || !p.projectId.trim() || seenIds.has(id)) badPlans.add(i);
    if (id) seenIds.add(id);
    const seenPeriods = new Set<string>();
    for (const pr of p.periods) {
      const label = pr.period.trim();
      if (!label || seenPeriods.has(label) || !Number.isFinite(pr.amount)) badPlans.add(i);
      if (label) seenPeriods.add(label);
    }
  });

  const onSave = () => {
    const cleaned: BudgetPlan[] = plans.map((p) => ({
      id: p.id.trim(),
      projectId: p.projectId.trim(),
      currency: p.currency.trim(),
      periods: p.periods.map((pr) => ({ period: pr.period.trim(), amount: pr.amount })),
    }));
    save.mutate(cleaned, {
      onSuccess: () => toast({ title: "BUDGET PLANS SAVED", description: "Planned budgets updated." }),
      onError: (e) => toast({ title: "COULD NOT SAVE", description: e instanceof Error ? e.message : "Check the plans and try again.", variant: "destructive" }),
    });
  };

  return (
    <AdminSection icon={Wallet} title="Budget plans" testId="budget-plans-admin" bodyClassName="space-y-4">
      <p className="text-xs text-muted-foreground">
        Plan a project's budget by period (year / quarter / month). The Budgets screen rolls these up
        automatically. Currency defaults to the deployment's reporting currency when left blank.
      </p>

      {plans.length === 0 && <p className="text-xs text-muted-foreground" data-testid="budget-plans-empty">No budget plans yet.</p>}

      <div className="space-y-4">
        {plans.map((plan, i) => {
          const setPeriod = (k: number, patch: Partial<{ period: string; amount: number }>) =>
            setPlan(i, { periods: plan.periods.map((pr, j) => (j === k ? { ...pr, ...patch } : pr)) });
          return (
            <div key={i} className={`border-2 p-3 space-y-2 ${badPlans.has(i) ? "border-red-500/50" : "border-border"}`} data-testid={`budget-plan-${i}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Input aria-label={`Plan ${i + 1} id`} placeholder="plan id" value={plan.id} onChange={(e) => setPlan(i, { id: e.target.value })} className="h-8 max-w-40 font-mono" data-testid={`budget-plan-id-${i}`} />
                <Input aria-label={`Plan ${i + 1} project id`} placeholder="project id" value={plan.projectId} onChange={(e) => setPlan(i, { projectId: e.target.value })} className="h-8 max-w-40 font-mono" data-testid={`budget-plan-project-${i}`} />
                <Input aria-label={`Plan ${i + 1} currency`} placeholder="currency (e.g. GBP)" value={plan.currency} onChange={(e) => setPlan(i, { currency: e.target.value })} className="h-8 max-w-32 font-mono" data-testid={`budget-plan-currency-${i}`} />
                <Button type="button" variant="destructive" size="sm" onClick={() => setDraft(plans.filter((_, j) => j !== i))} data-testid={`budget-plan-remove-${i}`}>Remove plan</Button>
              </div>
              <EditableRowTable
                rows={plan.periods}
                rowKey={(_, k) => k}
                rowTestId={(_, k) => `budget-period-${i}-${k}`}
                onRemove={(k) => setPlan(i, { periods: plan.periods.filter((_, j) => j !== k) })}
                removeLabel={(k) => `Remove period ${k + 1}`}
                emptyText="No periods yet."
                columns={[
                  { header: "Period", cell: (pr, k) => <Input aria-label={`Plan ${i + 1} period ${k + 1} label`} placeholder="2026 / 2026-Q1" value={pr.period} onChange={(e) => setPeriod(k, { period: e.target.value })} className="h-8 max-w-40" /> },
                  { header: "Amount", cell: (pr, k) => <Input aria-label={`Plan ${i + 1} period ${k + 1} amount`} type="number" value={Number.isFinite(pr.amount) ? pr.amount : ""} onChange={(e) => setPeriod(k, { amount: e.target.value === "" ? NaN : Number(e.target.value) })} className="h-8 max-w-32 tabular-nums" /> },
                ]}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => setPlan(i, { periods: [...plan.periods, { period: "", amount: 0 }] })} data-testid={`budget-period-add-${i}`}>Add period</Button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setDraft([...plans, emptyPlan(plans.length + 1)])} data-testid="budget-plan-add">Add plan</Button>
        {dirty && <Button type="button" variant="ghost" size="sm" onClick={reset}>Reset</Button>}
        <Button type="button" size="sm" onClick={onSave} disabled={!dirty || badPlans.size > 0 || save.isPending} data-testid="budget-plans-save">
          {save.isPending ? "SAVING…" : "Save budget plans"}
        </Button>
      </div>
    </AdminSection>
  );
}
