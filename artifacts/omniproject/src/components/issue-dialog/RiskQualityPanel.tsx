import type { Dispatch, SetStateAction } from "react";
import { Input } from "@/components/ui/input";
import type { IssueForm, FieldPredicate } from "./use-issue-form";

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
  return (
    <div className="border-t border-border pt-4 space-y-3">
      <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Risk &amp; quality</h3>
      <div className="grid grid-cols-2 gap-4">
        {showF("healthStatus") && (
          <div className="space-y-1">
            <label htmlFor="issue-health" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Health (RAG)</label>
            <Input id="issue-health" value={form.healthStatus} disabled={!editF("healthStatus")}
              onChange={(e) => setForm((p) => ({ ...p, healthStatus: e.target.value }))}
              placeholder="green / amber / red" className="rounded-none border-border font-mono disabled:opacity-60" />
          </div>
        )}
        {showF("riskLevel") && (
          <div className="space-y-1">
            <label htmlFor="issue-risk-level" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Risk level</label>
            <Input id="issue-risk-level" value={form.riskLevel} disabled={!editF("riskLevel")}
              onChange={(e) => setForm((p) => ({ ...p, riskLevel: e.target.value }))}
              placeholder="low / medium / high" className="rounded-none border-border font-mono disabled:opacity-60" />
          </div>
        )}
        {showF("impact") && (
          <div className="space-y-1">
            <label htmlFor="issue-impact" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Impact</label>
            <Input id="issue-impact" value={form.impact} disabled={!editF("impact")}
              onChange={(e) => setForm((p) => ({ ...p, impact: e.target.value }))}
              placeholder="low / medium / high" className="rounded-none border-border font-mono disabled:opacity-60" />
          </div>
        )}
        {showF("urgency") && (
          <div className="space-y-1">
            <label htmlFor="issue-urgency" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Urgency</label>
            <Input id="issue-urgency" value={form.urgency} disabled={!editF("urgency")}
              onChange={(e) => setForm((p) => ({ ...p, urgency: e.target.value }))}
              placeholder="low / medium / high" className="rounded-none border-border font-mono disabled:opacity-60" />
          </div>
        )}
        {showF("defectCount") && (
          <div className="space-y-1">
            <label htmlFor="issue-defect-count" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Defect count</label>
            <Input id="issue-defect-count" type="number" inputMode="numeric" value={form.defectCount} disabled={!editF("defectCount")}
              onChange={(e) => setForm((p) => ({ ...p, defectCount: e.target.value }))}
              placeholder="0" className="rounded-none border-border font-mono disabled:opacity-60" />
          </div>
        )}
      </div>
      {showF("blocked") && (
        <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <input type="checkbox" aria-label="Blocked" checked={form.blocked} disabled={!editF("blocked")}
            onChange={(e) => setForm((p) => ({ ...p, blocked: e.target.checked }))}
            className="h-4 w-4 accent-red-500 disabled:opacity-60" />
          Blocked
        </label>
      )}
      {showF("blockedReason") && (
        <div className="space-y-1">
          <label htmlFor="issue-blocked-reason" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Blocked reason</label>
          <Input id="issue-blocked-reason" value={form.blockedReason} disabled={!editF("blockedReason")}
            onChange={(e) => setForm((p) => ({ ...p, blockedReason: e.target.value }))}
            placeholder="What's blocking it?" className="rounded-none border-border font-mono disabled:opacity-60" />
        </div>
      )}
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
