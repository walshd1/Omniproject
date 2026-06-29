import { useEffect, useState } from "react";
import { useA11yPrefs } from "./a11y-prefs";

/**
 * Whether motion should be reduced — the union of the **explicit per-user preference**
 * (lib/a11y-prefs `reduceMotion`) and the **OS setting** (`prefers-reduced-motion: reduce`). CSS
 * already collapses animation/transition *durations* under both signals; this hook lets components
 * make the stronger choice of not rendering an animated element at all (e.g. a static skeleton
 * instead of a pulsing one), which is cheaper and avoids any residual motion.
 */
export function useReducedMotion(): boolean {
  const { prefs } = useA11yPrefs();
  const [osReduced, setOsReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setOsReduced(mq.matches);
    const onChange = () => setOsReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  return prefs.reduceMotion || osReduced;
}
