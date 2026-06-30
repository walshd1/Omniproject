import { Button } from "@/components/ui/button";
import { useFeatures, useSetDisabledFeatures, type FeatureStatus } from "../../lib/features";

/**
 * Admin panel for the optional feature modules. Everything is on by default; an admin switches a
 * module off and the gateway stops serving it (and, on the next restart, stops loading its code).
 * Disabling persists to the config bundle (settings.disabledFeatures), so the chosen module set
 * travels with the deployment.
 */
export function FeatureModulesAdmin() {
  const { data: features, isLoading } = useFeatures();
  const setDisabled = useSetDisabledFeatures();

  if (isLoading || !features) return null;

  // This panel governs the toggleable modules only; reports + methodologies live in FeatureGovernance.
  const modules = features.filter((x) => x.kind === "module");

  function toggle(f: FeatureStatus) {
    const disabled = new Set(modules.filter((x) => !x.enabled).map((x) => x.id));
    if (f.enabled) disabled.add(f.id);
    else disabled.delete(f.id);
    setDisabled.mutate([...disabled]);
  }

  return (
    <section className="space-y-3" data-testid="feature-modules">
      <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Feature modules</h2>
      <p className="text-xs text-muted-foreground">
        Optional backend modules. Switch off anything you don't use — a disabled module isn't served,
        and its code isn't loaded at the next restart, so you only run what you need.
      </p>
      <ul className="divide-y divide-border border-2 border-foreground">
        {modules.map((f) => (
          <li key={f.id} className="flex items-start justify-between gap-4 p-3">
            <div>
              <p className="font-bold">{f.label}</p>
              <p className="text-xs text-muted-foreground">{f.description}</p>
              {f.needsRestart && (
                <p className="mt-1 text-[11px] font-mono text-amber-600">Enabled — restart to load its code.</p>
              )}
            </div>
            <Button
              onClick={() => toggle(f)}
              disabled={setDisabled.isPending}
              variant="outline"
              aria-pressed={f.enabled}
              className="shrink-0 rounded-none border-2 border-foreground font-bold uppercase tracking-wider"
            >
              {f.enabled ? "On" : "Off"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
