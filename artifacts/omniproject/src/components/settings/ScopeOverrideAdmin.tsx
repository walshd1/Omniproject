import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { isDelegationAllowed, DEFAULT_PRIORITY_WEIGHTS } from "@workspace/backend-catalogue";
import { useDelegationPolicy } from "../../lib/delegation-policy-api";
import {
  useRulesetCatalogue, useRulesetScopeOverride, useSaveRulesetScopeOverride,
  useSettingsScopeOverride, useSaveSettingsScopeOverride,
  type OverrideScope, type RuleMode, type RulesetOverride,
} from "../../lib/scope-override-api";

/**
 * Scope overrides (PMO/admin) — author a programme's/project's OWN tightened ruleset and allow-listed settings.
 * Pick a scope, then: raise business-rule modes (tighten-only — off<warn<hard, you can't loosen the org),
 * and/or set the scope-variable settings (reporting currency, fx policy, priority weights). Both are gated by
 * the delegation policy — an area whose depth the org hasn't opened is shown disabled with the reason.
 */
const MODE_RANK: Record<RuleMode, number> = { off: 0, warn: 1, hard: 2 };
const FX_POLICIES = ["spot", "periodClose", "budgetRate"] as const;
const WEIGHT_KEYS = Object.keys(DEFAULT_PRIORITY_WEIGHTS);

export function ScopeOverrideAdmin() {
  const [kind, setKind] = useState<"programme" | "project">("project");
  const [id, setId] = useState("");
  const scope: OverrideScope | null = id.trim() ? { kind, id: id.trim() } : null;
  const { data: policy } = useDelegationPolicy();

  const rulesetAllowed = policy ? isDelegationAllowed(policy.policy.ruleset, kind) : false;
  const settingsAllowed = policy ? isDelegationAllowed(policy.policy.settings, kind) : false;

  return (
    <div className="space-y-3 border-t border-border pt-4" data-testid="scope-override">
      <div>
        <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Scope overrides</h3>
        <p className="text-xs text-muted-foreground">Give a programme or project its own tightened rules or settings, within the limits you set above.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Scope type" className="rounded-none border border-border bg-card px-2 py-1 text-xs" value={kind} onChange={(e) => setKind(e.target.value as "programme" | "project")}>
          <option value="programme">Programme</option>
          <option value="project">Project</option>
        </select>
        <input aria-label="Scope id" className="rounded-none border border-border bg-card px-3 py-1.5 text-sm" placeholder={`${kind} id`} value={id} onChange={(e) => setId(e.target.value)} />
      </div>

      {scope && <RulesetOverrideEditor scope={scope} allowed={rulesetAllowed} allowedLevel={policy?.policy.ruleset ?? "org"} />}
      {scope && <SettingsOverrideEditor scope={scope} allowed={settingsAllowed} allowedLevel={policy?.policy.settings ?? "org"} />}
    </div>
  );
}

/** A short "not allowed at this depth" note derived from the delegation policy. */
function DisallowedNote({ area, level }: { area: string; level: string }) {
  return <p className="text-[11px] text-amber-600 dark:text-amber-400">Local variation of {area} is only allowed down to <b>{level}</b> — open it further in the delegation policy above to edit this scope.</p>;
}

function RulesetOverrideEditor({ scope, allowed, allowedLevel }: { scope: OverrideScope; allowed: boolean; allowedLevel: string }) {
  const { toast } = useToast();
  const { data: catalogue = [] } = useRulesetCatalogue();
  const { data: stored } = useRulesetScopeOverride(scope);
  const save = useSaveRulesetScopeOverride();
  // Draft modes: rule id → chosen override mode (absent = inherit the org base).
  const [modes, setModes] = useState<Record<string, RuleMode>>({});
  useEffect(() => { setModes(stored?.override.modes ?? {}); }, [stored]);

  const onSave = () => {
    const override: RulesetOverride = { modes, fieldRules: stored?.override.fieldRules ?? [] };
    save.mutate({ scope, override }, {
      onSuccess: () => toast({ title: "Ruleset override saved", description: `${scope.kind} ${scope.id} now enforces its tightened rules.` }),
      onError: (e) => toast({ title: "Couldn't save", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-1.5" data-testid="ruleset-override-editor">
      <h4 className="text-xs font-bold uppercase tracking-wider">Ruleset (tighten only)</h4>
      {!allowed ? <DisallowedNote area="rulesets" level={allowedLevel} /> : (
        <>
          <ul className="space-y-1">
            {catalogue.map((r) => {
              const baseRank = MODE_RANK[r.mode];
              const options: RuleMode[] = (["off", "warn", "hard"] as RuleMode[]).filter((m) => MODE_RANK[m] >= baseRank);
              const value = modes[r.id] ?? "";
              return (
                <li key={r.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate" title={r.description}>{r.label} <span className="text-[10px] text-muted-foreground">(org: {r.mode})</span></span>
                  <select
                    aria-label={`Override mode for ${r.label}`}
                    className="rounded-none border border-border bg-card px-1.5 py-0.5 text-[11px]"
                    value={value}
                    onChange={(e) => setModes((m) => { const next = { ...m }; if (e.target.value) next[r.id] = e.target.value as RuleMode; else delete next[r.id]; return next; })}
                  >
                    <option value="">Inherit ({r.mode})</option>
                    {options.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </li>
              );
            })}
          </ul>
          <button type="button" data-testid="ruleset-override-save" disabled={save.isPending} className="px-3 py-1 text-[11px] font-black uppercase tracking-widest rounded-none border-2 border-foreground disabled:opacity-50" onClick={onSave}>
            {save.isPending ? "Saving…" : "Save ruleset override"}
          </button>
        </>
      )}
    </div>
  );
}

function SettingsOverrideEditor({ scope, allowed, allowedLevel }: { scope: OverrideScope; allowed: boolean; allowedLevel: string }) {
  const { toast } = useToast();
  const { data: stored } = useSettingsScopeOverride(scope);
  const save = useSaveSettingsScopeOverride();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  useEffect(() => { setDraft(stored?.override ?? {}); }, [stored]);

  const weights = useMemo(() => (draft["priorityWeights"] as Record<string, number> | undefined) ?? {}, [draft]);
  const setField = (k: string, v: unknown) => setDraft((d) => { const next = { ...d }; if (v === "" || v === undefined) delete next[k]; else next[k] = v; return next; });

  const onSave = () => {
    save.mutate({ scope, patch: draft }, {
      onSuccess: (r) => toast({ title: "Settings override saved", description: r.rejected.length ? `Applied; ${r.rejected.length} non-scope key(s) refused.` : "Applied." }),
      onError: (e) => toast({ title: "Couldn't save", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-1.5" data-testid="settings-override-editor">
      <h4 className="text-xs font-bold uppercase tracking-wider">Settings (scope-variable)</h4>
      {!allowed ? <DisallowedNote area="settings" level={allowedLevel} /> : (
        <>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span>Reporting currency</span>
            <input aria-label="Reporting currency" className="rounded-none border border-border bg-card px-2 py-0.5 text-[11px] w-24" placeholder="inherit" value={(draft["reportingCurrency"] as string) ?? ""} onChange={(e) => setField("reportingCurrency", e.target.value.toUpperCase())} />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span>FX rate policy</span>
            <select aria-label="FX rate policy" className="rounded-none border border-border bg-card px-1.5 py-0.5 text-[11px]" value={(draft["fxRatePolicy"] as string) ?? ""} onChange={(e) => setField("fxRatePolicy", e.target.value)}>
              <option value="">Inherit</option>
              {FX_POLICIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <div className="text-xs">
            <span>Priority weights</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {WEIGHT_KEYS.map((k) => (
                <label key={k} className="flex items-center gap-1 text-[11px]">
                  <span className="uppercase text-muted-foreground">{k}</span>
                  <input
                    aria-label={`Priority weight ${k}`}
                    type="number"
                    className="rounded-none border border-border bg-card px-1 py-0.5 text-[11px] w-14"
                    value={weights[k] ?? ""}
                    onChange={(e) => setField("priorityWeights", { ...DEFAULT_PRIORITY_WEIGHTS, ...weights, [k]: Number(e.target.value) })}
                  />
                </label>
              ))}
            </div>
          </div>
          <button type="button" data-testid="settings-override-save" disabled={save.isPending} className="px-3 py-1 text-[11px] font-black uppercase tracking-widest rounded-none border-2 border-foreground disabled:opacity-50" onClick={onSave}>
            {save.isPending ? "Saving…" : "Save settings override"}
          </button>
        </>
      )}
    </div>
  );
}
