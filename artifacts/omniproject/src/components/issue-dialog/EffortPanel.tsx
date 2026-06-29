import type { Dispatch, SetStateAction } from "react";
import { Input } from "@/components/ui/input";
import { effortProgress } from "../../lib/effort";
import type { IssueForm, FieldPredicate } from "./use-issue-form";

interface EffortPanelProps {
  form: IssueForm;
  setForm: Dispatch<SetStateAction<IssueForm>>;
  showF: FieldPredicate;
  editF: FieldPredicate;
}

export function EffortPanel({ form, setForm, showF, editF }: EffortPanelProps) {
  if (!(showF("estimateHours") || showF("loggedHours") || showF("remainingHours") || showF("storyPoints"))) {
    return null;
  }
  return (
    <div className="border-t border-border pt-4 space-y-3">
      <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Effort</h3>
      <div className="grid grid-cols-3 gap-4">
        {showF("estimateHours") && (
          <div className="space-y-1">
            <label htmlFor="issue-estimate-hours" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Estimate (h)</label>
            <Input id="issue-estimate-hours" type="number" inputMode="decimal" value={form.estimateHours} disabled={!editF("estimateHours")}
              onChange={(e) => setForm((p) => ({ ...p, estimateHours: e.target.value }))}
              placeholder="0" className="rounded-none border-border font-mono disabled:opacity-60" />
          </div>
        )}
        {showF("loggedHours") && (
          <div className="space-y-1">
            <label htmlFor="issue-logged-hours" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Logged (h)</label>
            <Input id="issue-logged-hours" type="number" inputMode="decimal" value={form.loggedHours} disabled={!editF("loggedHours")}
              onChange={(e) => setForm((p) => ({ ...p, loggedHours: e.target.value }))}
              placeholder="0" className="rounded-none border-border font-mono disabled:opacity-60" />
          </div>
        )}
        {showF("remainingHours") && (
          <div className="space-y-1">
            <label htmlFor="issue-remaining-hours" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Remaining (h)</label>
            <Input id="issue-remaining-hours" type="number" inputMode="decimal" value={form.remainingHours} disabled={!editF("remainingHours")}
              onChange={(e) => setForm((p) => ({ ...p, remainingHours: e.target.value }))}
              placeholder="0" className="rounded-none border-border font-mono disabled:opacity-60" />
          </div>
        )}
        {showF("storyPoints") && (
          <div className="space-y-1">
            <label htmlFor="issue-story-points" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Story points</label>
            <Input id="issue-story-points" type="number" inputMode="decimal" value={form.storyPoints} disabled={!editF("storyPoints")}
              onChange={(e) => setForm((p) => ({ ...p, storyPoints: e.target.value }))}
              placeholder="0" className="rounded-none border-border font-mono disabled:opacity-60" />
          </div>
        )}
      </div>
      {/* Derived estimate-vs-logged progress — shown only when both are surfaced and present. */}
      {showF("estimateHours") && showF("loggedHours") && (() => {
        const prog = effortProgress(Number(form.estimateHours), Number(form.loggedHours));
        if (prog.band === "unknown") return null;
        const tone = prog.band === "over" ? "bg-red-500" : prog.band === "near" ? "bg-amber-500" : "bg-primary";
        return (
          <div className="space-y-1" data-testid="effort-progress">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <span>Logged vs estimate</span>
              <span className={prog.band === "over" ? "text-red-500" : ""}>
                {prog.pct}%{prog.variance != null && prog.variance < 0 ? ` · ${-prog.variance}h over` : ""}
              </span>
            </div>
            <div className="h-2 w-full bg-background border border-border">
              <div className={`h-full ${tone}`} style={{ width: `${prog.barPct}%` }} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}
