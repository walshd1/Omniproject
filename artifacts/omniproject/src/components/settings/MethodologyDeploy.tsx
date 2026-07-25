import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useMethodologyDeploymentPreview, useDeployMethodology } from "../../lib/methodology-composition-api";

/**
 * One-click methodology DEPLOY (PMO/admin) — the "turn this methodology on" affordance that complements the
 * per-item composer. Pick a methodology → preview the whole bundle it lands (screens/ruleset/business rules/
 * settings + its nomenclature) → Deploy sets the composition to its tagged surfaces and applies its ruleset +
 * preset settings server-side, at the org (or a nearer scope). It's the inverse of hand-ticking items: the
 * methodology's known-good posture in one action.
 */
export function MethodologyDeploy({ methodologies }: { methodologies: Array<{ id: string; label: string }> }) {
  const { toast } = useToast();
  const [picked, setPicked] = useState<string | null>(null);
  const { data: plan } = useMethodologyDeploymentPreview(picked);
  const deploy = useDeployMethodology();

  const onDeploy = () => {
    if (!picked) return;
    deploy.mutate({ methodologyId: picked }, {
      onSuccess: (r) => toast({ title: "Methodology deployed", description: `${plan?.label ?? picked} is live${r.appliedRuleset ? ` · ${r.appliedRuleset} ruleset` : ""}${r.appliedSettings.length ? ` · ${r.appliedSettings.length} setting${r.appliedSettings.length === 1 ? "" : "s"}` : ""}.` }),
      onError: (e) => toast({ title: "Deploy failed", description: e instanceof Error ? e.message : "Could not deploy.", variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-2 border-t border-border pt-4" data-testid="methodology-deploy">
      <div>
        <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">One-click deploy</h3>
        <p className="text-xs text-muted-foreground">Turn a whole methodology on — its screens, ruleset, business rules, settings and nomenclature — in a single action.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs">
          <span className="uppercase tracking-widest text-muted-foreground">Methodology</span>
          <select
            aria-label="Methodology to deploy"
            className="rounded-none border border-border bg-card px-2 py-1 text-xs"
            value={picked ?? ""}
            onChange={(e) => setPicked(e.target.value || null)}
          >
            <option value="">— pick —</option>
            {methodologies.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <button
          type="button"
          data-testid="methodology-deploy-apply"
          disabled={!picked || deploy.isPending}
          className="px-3 py-1.5 text-xs font-black uppercase tracking-widest rounded-none border-2 border-foreground disabled:opacity-50"
          onClick={onDeploy}
        >
          {deploy.isPending ? "Deploying…" : "Deploy"}
        </button>
      </div>

      {plan && (
        <div className="text-[11px] text-muted-foreground space-y-1" data-testid="methodology-deploy-preview">
          <p>
            Turns on <b>{plan.summary.screens}</b> screen{plan.summary.screens === 1 ? "" : "s"}, <b>{plan.summary.reports}</b> report{plan.summary.reports === 1 ? "" : "s"}
            {plan.summary.hasRuleset ? <> · applies the <b>{plan.ruleset?.id}</b> ruleset</> : null}
            {plan.summary.invariants > 0 ? <> · <b>{plan.summary.invariants}</b> business rule{plan.summary.invariants === 1 ? "" : "s"}</> : null}
            {plan.summary.settings > 0 ? <> · <b>{plan.summary.settings}</b> preset setting{plan.summary.settings === 1 ? "" : "s"}</> : null}.
          </p>
          {plan.nomenclature.states.length > 0 && (
            <p>States: <span className="font-mono">{plan.nomenclature.states.join(" · ")}</span></p>
          )}
        </div>
      )}
    </div>
  );
}
