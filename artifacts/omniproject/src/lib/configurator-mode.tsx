import { createContext, useContext, useState, type ReactNode } from "react";

export type ConfiguratorMode = "guided" | "technical";

const STORAGE_KEY = "omni.configuratorMode";

const ConfiguratorModeContext = createContext<ConfiguratorMode>("guided");

/** True when Technical mode is active — consumed by `TechDetails` (shared.tsx) so
 *  every collapsed technical-detail panel across the Configurator expands by
 *  default without threading a prop through every step component. */
export function useIsTechnicalMode(): boolean {
  return useContext(ConfiguratorModeContext) === "technical";
}

function readStoredMode(): ConfiguratorMode {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "technical" ? "technical" : "guided";
  } catch {
    return "guided";
  }
}

/** Owns the Guided/Technical mode state for the Configurator page, persisted across visits. */
export function useConfiguratorMode(): [ConfiguratorMode, (mode: ConfiguratorMode) => void] {
  const [mode, setModeState] = useState<ConfiguratorMode>(readStoredMode);

  const setMode = (next: ConfiguratorMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* best-effort only — a private-browsing tab just won't remember the choice */
    }
  };

  return [mode, setMode];
}

export function ConfiguratorModeProvider({ mode, children }: { mode: ConfiguratorMode; children: ReactNode }) {
  return <ConfiguratorModeContext.Provider value={mode}>{children}</ConfiguratorModeContext.Provider>;
}
