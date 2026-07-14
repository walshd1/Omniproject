import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateSettings,
  getGetSettingsQueryKey,
  getGetCapabilitiesQueryKey,
  type SettingsUpdate,
} from "@workspace/api-client-react";
import { Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSettingsPresets, type SettingsPreset } from "../../lib/settings-presets";
import { settingConstraintsQueryKey } from "../../lib/setting-locks";

/**
 * "Start from a blueprint" — loads a known-good settings posture for a customer archetype in one click,
 * then the operator tweaks + saves. Reused by the setup wizard (Configurator) and the Settings page.
 * The server guarantees each blueprint is a valid combination; loading one is an ordinary settings
 * update, so it re-validates and can be undone/rolled back like any change.
 */
export function SettingsPresetPicker({ isAdmin = true }: { isAdmin?: boolean }) {
  const { presets, isLoading } = useSettingsPresets();
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const { toast } = useToast();

  const apply = (p: SettingsPreset): void => {
    if (!isAdmin) return;
    update.mutate(
      { data: p.settings as SettingsUpdate },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetCapabilitiesQueryKey() });
          qc.invalidateQueries({ queryKey: settingConstraintsQueryKey });
          toast({ title: "BLUEPRINT LOADED", description: `${p.label} applied — tweak anything below, then save.` });
        },
        onError: () => toast({ title: "COULD NOT LOAD BLUEPRINT", description: "Try again, or set the values manually below.", variant: "destructive" }),
      },
    );
  };

  if (isLoading || presets.length === 0) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-5" data-testid="settings-preset-picker">
      <div className="flex items-center gap-3">
        <Layers className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-lg font-bold">Start from a blueprint</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Load a known-good starting point for your kind of organisation — it just sets sensible defaults you
        can tweak. Everything remains editable and each blueprint can be rolled back like any change.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {presets.map((p) => (
          <div key={p.id} className="flex flex-col rounded-lg border border-border p-3" data-testid={`preset-${p.id}`}>
            <div className="font-semibold">{p.label}</div>
            <p className="mt-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">For: {p.audience}</p>
            <p className="mt-2 flex-1 text-xs text-muted-foreground">{p.description}</p>
            <button
              type="button"
              disabled={!isAdmin || update.isPending}
              data-testid={`preset-apply-${p.id}`}
              onClick={() => apply(p)}
              className={`mt-3 shrink-0 rounded border border-primary bg-primary px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-primary-foreground ${!isAdmin || update.isPending ? "opacity-60 cursor-not-allowed" : "hover:opacity-90"}`}
            >
              {update.isPending ? "Loading…" : "Load blueprint"}
            </button>
          </div>
        ))}
      </div>
      {!isAdmin && <p className="mt-3 text-xs text-muted-foreground">Sign in as an admin to load a blueprint.</p>}
    </section>
  );
}
