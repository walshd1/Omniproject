import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Rocket, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useUpdateSettings, type SettingsUpdate } from "@workspace/api-client-react";
import { usePresets, useApplyPreset, type Preset, type PresetApplyResult } from "../../lib/presets";
import { useSettingsPresets } from "../../lib/settings-presets";
import { useSaveMethodologyComposition } from "../../lib/methodology-composition-api";
import { buildCompositionItems, methodologyLabel } from "../../lib/methodology-composition-catalogue";
import { derivePresets, applyPreset as composeMethodology } from "../../lib/methodology-composition";

/**
 * "Start from a preset" — the ONE action that takes a new instance from zero to a configured way of working.
 * Picking a preset runs the whole bundle in sequence: the server-side pieces (its reference ruleset + a
 * starter project) via `/api/presets/:id/apply`, then the SPA-owned follow-ups the server can't do — load the
 * posture blueprint (a settings update) and curate the methodology composition (which needs the full catalogue
 * item set only the SPA holds). What's left after is the operator-paced part the wizard still guides: connect
 * your backend, wire SSO, verify. Applying needs pmo (the server re-checks); the panel is admin-gated in the UI.
 */
export function PresetStep({ isAdmin = true }: { isAdmin?: boolean }) {
  const { data: presets } = usePresets();
  const applyPresetMut = useApplyPreset();
  const updateSettings = useUpdateSettings();
  const { presets: blueprints } = useSettingsPresets();
  const saveComposition = useSaveMethodologyComposition();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [done, setDone] = useState<{ preset: Preset; result: PresetApplyResult } | null>(null);

  const apply = async (preset: Preset): Promise<void> => {
    if (!isAdmin || applyingId) return;
    setApplyingId(preset.id);
    try {
      // 1) Server bundle: reference ruleset + starter project.
      const result = await applyPresetMut.mutateAsync({ id: preset.id });

      // 2) Posture blueprint: load the archetype's known-good settings (an ordinary, re-validated settings update).
      if (result.followUps.settingsPreset) {
        const bp = blueprints.find((b) => b.id === result.followUps.settingsPreset);
        if (bp) await updateSettings.mutateAsync({ data: bp.settings as SettingsUpdate });
      }

      // 3) Methodology composition: curate the org to this methodology (its tagged items + the neutral ones).
      const methodologyPreset = derivePresets(buildCompositionItems(), methodologyLabel)
        .find((p) => p.methodology === result.followUps.methodologyComposition);
      if (methodologyPreset) await saveComposition.mutateAsync(composeMethodology(null, methodologyPreset));

      // The instance is reconfigured wholesale — refetch everything so the UI reflects the new posture.
      await qc.invalidateQueries();
      setDone({ preset, result });
      toast({ title: "PRESET LOADED", description: `${preset.label} — now connect your backend and verify below.` });
    } catch {
      toast({ title: "COULD NOT LOAD PRESET", description: "Some steps may not have applied — check your permissions and try again.", variant: "destructive" });
    } finally {
      setApplyingId(null);
    }
  };

  // Defensive: never trust the wire — a non-array (error body / stubbed fetch) yields no presets, not a crash.
  const list = Array.isArray(presets) ? presets : [];
  if (list.length === 0) return null;

  return (
    <section className="rounded-lg border border-primary/40 bg-primary/5 p-5" data-testid="preset-step">
      <div className="flex items-center gap-3">
        <Rocket className="w-4 h-4 text-primary" aria-hidden="true" />
        <h2 className="text-lg font-bold">Start from a preset</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Load a complete way of working in one step — it sets your posture, methodology, rules, a starter project
        and a dashboard. You then just connect your tool and verify. Everything stays editable.
      </p>

      {done && (
        <div className="mt-4 rounded-lg border border-primary bg-background p-3 text-sm" data-testid={`preset-applied-${done.preset.id}`}>
          <div className="flex items-center gap-2 font-semibold"><Check className="w-4 h-4 text-primary" />{done.preset.label} loaded</div>
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground list-disc pl-5">
            <li>Curated to the <strong className="text-foreground">{methodologyLabel(done.result.methodology) ?? done.result.methodology}</strong> methodology.</li>
            {done.result.applied.referenceRuleset && <li>Applied the {done.result.applied.referenceRuleset} reference ruleset.</li>}
            {done.result.applied.project && <li>Created a starter project with {done.result.applied.project.seeded} work item{done.result.applied.project.seeded === 1 ? "" : "s"}.</li>}
            {done.result.followUps.settingsPreset && <li>Loaded the {done.result.followUps.settingsPreset} posture blueprint.</li>}
            {done.result.followUps.dashboardPreset && <li className="text-foreground">Recommended dashboard: <strong>{done.result.followUps.dashboardPreset}</strong> — add it from Dashboards.</li>}
          </ul>
          <p className="mt-2 text-xs text-foreground">Next: connect your backend and verify, below.</p>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((p) => (
          <div key={p.id} className="flex flex-col rounded-lg border border-border bg-background p-3" data-testid={`preset-card-${p.id}`}>
            <div className="font-semibold">{p.label}</div>
            {p.tags && p.tags.length > 0 && <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{p.tags.join(" · ")}</p>}
            <p className="mt-2 flex-1 text-xs text-muted-foreground">{p.description}</p>
            <button
              type="button"
              disabled={!isAdmin || applyingId !== null}
              data-testid={`preset-load-${p.id}`}
              onClick={() => void apply(p)}
              className={`mt-3 shrink-0 rounded border border-primary bg-primary px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-primary-foreground ${!isAdmin || applyingId !== null ? "opacity-60 cursor-not-allowed" : "hover:opacity-90"}`}
            >
              {applyingId === p.id ? "Loading…" : "Load preset"}
            </button>
          </div>
        ))}
      </div>
      {!isAdmin && <p className="mt-3 text-xs text-muted-foreground">Sign in as an admin to load a preset.</p>}
    </section>
  );
}
