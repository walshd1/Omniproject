import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * Known-good settings blueprints for common customer archetypes. Loading one applies a whole sensible
 * posture (deployment profile, financial rigour, prioritisation, modules) in one click so setup is a
 * tweak rather than a field-by-field build. The server guarantees each is a valid combination.
 */
export interface SettingsPreset {
  id: string;
  label: string;
  audience: string;
  description: string;
  /** The posture this blueprint applies; merged over the current settings when loaded. */
  settings: Record<string, unknown>;
}

export const settingsPresetsQueryKey = ["settings", "presets"] as const;

/** The available settings blueprints (read-only, no secrets). */
export function useSettingsPresets(): { presets: SettingsPreset[]; isLoading: boolean } {
  const { data, isLoading } = useQuery<{ presets: SettingsPreset[] }>({
    queryKey: settingsPresetsQueryKey,
    queryFn: () => getJson("/api/settings/presets"),
    staleTime: 300_000,
  });
  return { presets: data?.presets ?? [], isLoading };
}
