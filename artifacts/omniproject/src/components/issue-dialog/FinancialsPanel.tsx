import type { Dispatch, SetStateAction } from "react";
import { Input } from "@/components/ui/input";
import type { IssueForm, FieldPredicate } from "./use-issue-form";

interface FinancialsPanelProps {
  form: IssueForm;
  setForm: Dispatch<SetStateAction<IssueForm>>;
  showF: FieldPredicate;
  editF: FieldPredicate;
}

export function FinancialsPanel({ form, setForm, showF, editF }: FinancialsPanelProps) {
  if (!(showF("budget") || showF("actualCost") || showF("billable") || showF("costCenter") || showF("currency"))) {
    return null;
  }
  return (
    <div className="border-t border-border pt-4 space-y-3">
      <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Financials</h3>
      <div className="grid grid-cols-2 gap-4">
        {showF("budget") && (
          <div className="space-y-1">
            <label htmlFor="issue-budget" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Budget</label>
            <Input id="issue-budget" type="number" inputMode="decimal" value={form.budget} disabled={!editF("budget")}
              onChange={(e) => setForm((p) => ({ ...p, budget: e.target.value }))}
              placeholder="0" className="rounded-none border-border font-mono disabled:opacity-60" />
          </div>
        )}
        {showF("actualCost") && (
          <div className="space-y-1">
            <label htmlFor="issue-actual-cost" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Actual cost</label>
            <Input id="issue-actual-cost" type="number" inputMode="decimal" value={form.actualCost} disabled={!editF("actualCost")}
              onChange={(e) => setForm((p) => ({ ...p, actualCost: e.target.value }))}
              placeholder="0" className="rounded-none border-border font-mono disabled:opacity-60" />
          </div>
        )}
        {showF("currency") && (
          <div className="space-y-1">
            <label htmlFor="issue-currency" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Currency</label>
            <Input id="issue-currency" value={form.currency} disabled={!editF("currency")}
              onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value.toUpperCase() }))}
              placeholder="GBP" maxLength={3} className="rounded-none border-border font-mono uppercase disabled:opacity-60" />
          </div>
        )}
        {showF("costCenter") && (
          <div className="space-y-1">
            <label htmlFor="issue-cost-center" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Cost centre</label>
            <Input id="issue-cost-center" value={form.costCenter} disabled={!editF("costCenter")}
              onChange={(e) => setForm((p) => ({ ...p, costCenter: e.target.value }))}
              placeholder="ENG-PLAT" className="rounded-none border-border font-mono disabled:opacity-60" />
          </div>
        )}
      </div>
      {showF("billable") && (
        <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <input type="checkbox" aria-label="Billable" checked={form.billable} disabled={!editF("billable")}
            onChange={(e) => setForm((p) => ({ ...p, billable: e.target.checked }))}
            className="h-4 w-4 accent-primary disabled:opacity-60" />
          Billable
        </label>
      )}
    </div>
  );
}
