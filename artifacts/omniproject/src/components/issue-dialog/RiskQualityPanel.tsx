import type { Dispatch, SetStateAction } from "react";
import type { IssueForm, FieldPredicate } from "./use-issue-form";
import { GatedTextField } from "./GatedTextField";

interface RiskQualityPanelProps {
  form: IssueForm;
  setForm: Dispatch<SetStateAction<IssueForm>>;
  showF: FieldPredicate;
  editF: FieldPredicate;
}

export function RiskQualityPanel({ form, setForm, showF, editF }: RiskQualityPanelProps) {
  if (
    !(showF("healthStatus") || showF("riskLevel") || showF("impact") || showF("urgency") || showF("blocked") || showF("blockedReason") || showF("mitigation") || showF("defectCount"))
  ) {
    return null;
  }
  const field = { form, setForm, showF, editF };
  return (
    <div className="border-t border-border pt-4 space-y-3">
      <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Risk &amp; quality</h3>
      <div className="grid grid-cols-2 gap-4">
        <GatedTextField {...field} name="healthStatus" id="issue-health" label="Health (RAG)" placeholder="green / amber / red" />
        <GatedTextField {...field} name="riskLevel" id="issue-risk-level" label="Risk level" placeholder="low / medium / high" />
        <GatedTextField {...field} name="impact" id="issue-impact" label="Impact" placeholder="low / medium / high" />
        <GatedTextField {...field} name="urgency" id="issue-urgency" label="Urgency" placeholder="low / medium / high" />
        <GatedTextField {...field} name="defectCount" id="issue-defect-count" label="Defect count" type="number" inputMode="numeric" placeholder="0" />
      </div>
      {showF("blocked") && (
        <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <input type="checkbox" aria-label="Blocked" checked={form.blocked} disabled={!editF("blocked")}
            onChange={(e) => setForm((p) => ({ ...p, blocked: e.target.checked }))}
            className="h-4 w-4 accent-red-500 disabled:opacity-60" />
          Blocked
        </label>
      )}
      <GatedTextField {...field} name="blockedReason" id="issue-blocked-reason" label="Blocked reason" placeholder="What's blocking it?" />
      {showF("mitigation") && (
        <div className="space-y-1">
          <label htmlFor="issue-mitigation" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Mitigation</label>
          <textarea id="issue-mitigation" value={form.mitigation} disabled={!editF("mitigation")}
            onChange={(e) => setForm((p) => ({ ...p, mitigation: e.target.value }))}
            placeholder="Plan to reduce the risk…" rows={2}
            className="w-full bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-primary resize-none disabled:opacity-60" />
        </div>
      )}
    </div>
  );
}
