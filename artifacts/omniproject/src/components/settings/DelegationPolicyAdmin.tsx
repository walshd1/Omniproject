import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import type { DelegationArea, DelegationLevel, DelegationPolicy } from "@workspace/backend-catalogue";
import { useDelegationPolicy, useSetDelegationPolicy } from "../../lib/delegation-policy-api";

/**
 * Delegation policy (PMO/admin) — the governance dial: for each area (rulesets / settings / methodology), how
 * far DOWN the scope hierarchy local variation is allowed. "Set the level you'll allow, and no further." A
 * write deeper than the chosen level is refused by the server. Default is fully centralized (org everywhere).
 */
const AREA_LABEL: Record<DelegationArea, string> = {
  ruleset: "Business rulesets",
  settings: "Settings",
  methodologyComposition: "Methodology",
};
const LEVEL_LABEL: Record<DelegationLevel, string> = {
  org: "Org only (no local variation)",
  programme: "Down to programme",
  project: "Down to project",
  user: "Down to individual user",
};

export function DelegationPolicyAdmin() {
  const { toast } = useToast();
  const { data } = useDelegationPolicy();
  const save = useSetDelegationPolicy();
  const [draft, setDraft] = useState<DelegationPolicy | null>(null);

  // Seed the draft once the server policy loads; thereafter the draft is the source of truth.
  useEffect(() => { setDraft((d) => (d === null && data?.policy ? data.policy : d)); }, [data]);

  if (!data || !draft) return null;
  const changed = JSON.stringify(draft) !== JSON.stringify(data.policy);

  const onSave = () => {
    save.mutate(draft, {
      onSuccess: () => toast({ title: "Delegation policy saved", description: "Scope-level variation now follows the new limits." }),
      onError: (e) => toast({ title: "Couldn't save", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-2 border-t border-border pt-4" data-testid="delegation-policy">
      <div>
        <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Local variation</h3>
        <p className="text-xs text-muted-foreground">Choose how far down each of these a programme, project or user may differ from the org. A deeper change is refused.</p>
      </div>
      <div className="space-y-1.5">
        {data.areas.map((area) => (
          <label key={area} className="flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold">{AREA_LABEL[area] ?? area}</span>
            <select
              aria-label={`Local variation for ${AREA_LABEL[area] ?? area}`}
              className="rounded-none border border-border bg-card px-2 py-1 text-[11px]"
              value={draft[area]}
              onChange={(e) => setDraft({ ...draft, [area]: e.target.value as DelegationLevel })}
            >
              {data.levels.map((lvl) => <option key={lvl} value={lvl}>{LEVEL_LABEL[lvl] ?? lvl}</option>)}
            </select>
          </label>
        ))}
      </div>
      <button
        type="button"
        data-testid="delegation-policy-save"
        disabled={!changed || save.isPending}
        className="px-3 py-1.5 text-xs font-black uppercase tracking-widest rounded-none border-2 border-foreground disabled:opacity-50"
        onClick={onSave}
      >{save.isPending ? "Saving…" : "Save limits"}</button>
    </div>
  );
}
