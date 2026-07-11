import type { Dispatch, SetStateAction } from "react";
import type { IssueForm, FieldPredicate } from "./use-issue-form";
import { GatedTextField } from "./GatedTextField";

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
  const field = { form, setForm, showF, editF };
  return (
    <div className="border-t border-border pt-4 space-y-3">
      <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Financials</h3>
      <div className="grid grid-cols-2 gap-4">
        <GatedTextField {...field} name="budget" id="issue-budget" label="Budget" type="number" inputMode="decimal" placeholder="0" />
        <GatedTextField {...field} name="actualCost" id="issue-actual-cost" label="Actual cost" type="number" inputMode="decimal" placeholder="0" />
        <GatedTextField {...field} name="currency" id="issue-currency" label="Currency" placeholder="GBP" maxLength={3} transform={(v) => v.toUpperCase()} className="uppercase" />
        <GatedTextField {...field} name="costCenter" id="issue-cost-center" label="Cost centre" placeholder="ENG-PLAT" />
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
