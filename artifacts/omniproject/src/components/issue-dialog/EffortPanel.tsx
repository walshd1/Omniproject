import type { Dispatch, SetStateAction } from "react";
import { effortProgress } from "../../lib/effort";
import type { IssueForm, FieldPredicate } from "./use-issue-form";
import { GatedTextField } from "./GatedTextField";

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
  const field = { form, setForm, showF, editF };
  return (
    <div className="border-t border-border pt-4 space-y-3">
      <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Effort</h3>
      <div className="grid grid-cols-3 gap-4">
        <GatedTextField {...field} name="estimateHours" id="issue-estimate-hours" label="Estimate (h)" type="number" inputMode="decimal" placeholder="0" />
        <GatedTextField {...field} name="loggedHours" id="issue-logged-hours" label="Logged (h)" type="number" inputMode="decimal" placeholder="0" />
        <GatedTextField {...field} name="remainingHours" id="issue-remaining-hours" label="Remaining (h)" type="number" inputMode="decimal" placeholder="0" />
        <GatedTextField {...field} name="storyPoints" id="issue-story-points" label="Story points" type="number" inputMode="decimal" placeholder="0" />
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
