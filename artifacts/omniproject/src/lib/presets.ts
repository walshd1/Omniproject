import { useQuery, useMutation } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Quick-load PRESET client hooks over `/api/presets`. A preset is a named bundle that configures an org for a
 * way of working in one action (see the api-server preset-catalogue). Listing is viewer+; applying is pmo. The
 * apply RESPONSE carries `followUps` — the SPA-owned steps the server can't do (curate the methodology
 * composition, which needs the full catalogue item set the SPA holds; load the posture blueprint; mint the
 * persona dashboard) — which the Configurator's preset entry completes after the server-side bundle lands.
 */

/** A shipped preset (mirrors the api-server `Preset`). */
export interface Preset {
  id: string;
  label: string;
  description: string;
  methodology: string;
  settingsPreset?: string;
  referenceRuleset?: string;
  projectTemplate?: string;
  dashboardPreset?: string;
  tags?: string[];
  order: number;
}

/** The result of applying a preset. */
export interface PresetApplyResult {
  presetId: string;
  methodology: string;
  applied: {
    referenceRuleset?: string;
    project?: { id: string; seeded: number };
  };
  followUps: {
    methodologyComposition: string;
    settingsPreset?: string;
    dashboardPreset?: string;
  };
}

export const presetsKey = ["presets"] as const;

/** The shipped presets. */
export function usePresets() {
  return useQuery({ queryKey: presetsKey, queryFn: () => getJson<Preset[]>("/api/presets"), staleTime: 60_000 });
}

/** Apply a preset (pmo) — runs the server-side bundle (reference ruleset + starter project) and returns the
 *  follow-ups the caller finishes. Body carries an optional project name for the starter project. */
export function useApplyPreset() {
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name?: string }) =>
      sendJson<PresetApplyResult>(`/api/presets/${encodeURIComponent(id)}/apply`, name ? { name } : {}, "POST"),
  });
}
