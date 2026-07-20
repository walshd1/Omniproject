import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { detectPlatform, resolveMobile, type Platform } from "./platform";
import { useA11yPrefs } from "./a11y-prefs";

/**
 * Live platform context. Tracks the device's capabilities + form factor (re-detecting
 * on resize / orientation / display-mode changes) and resolves the user's mobile-mode
 * preference into an effective `isMobile`. It also reflects the result onto the
 * document root as data-attributes so the stylesheet can adapt without prop-drilling:
 *   data-form-factor, data-mobile, data-touch, data-standalone.
 */
interface PlatformContextValue {
  platform: Platform;
  /** Effective touch-optimised layout (pref `auto` follows the device; `on`/`off` force it). */
  isMobile: boolean;
}

const PlatformContext = createContext<PlatformContextValue | null>(null);

/** A cheap identity for a platform snapshot — re-render only when this changes. */
function signature(p: Platform): string {
  return `${p.formFactor}|${p.touch}|${p.standalone}|${p.speechRecognition}|${p.webShare}|${p.serviceWorker}|${p.nativeBridge}|${p.os}|${p.engine}`;
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  const { prefs } = useA11yPrefs();
  const [platform, setPlatform] = useState<Platform>(() => detectPlatform());

  // Re-detect when the viewport, orientation, or installed/standalone state changes.
  // Resize fires in bursts (drag-resize, the mobile URL bar showing/hiding), so we
  // coalesce to one detection per frame and only re-render when something a consumer
  // cares about actually changed — not on every pixel.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = detectPlatform();
        setPlatform((prev) => (signature(prev) === signature(next) ? prev : next));
      });
    };
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    const standaloneMq = window.matchMedia?.("(display-mode: standalone)");
    standaloneMq?.addEventListener?.("change", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      standaloneMq?.removeEventListener?.("change", update);
    };
  }, []);

  const isMobile = resolveMobile(prefs.mobileMode, platform.formFactor);

  // Reflect onto the document root for CSS hooks.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.setAttribute("data-form-factor", platform.formFactor);
    root.setAttribute("data-mobile", isMobile ? "true" : "false");
    root.setAttribute("data-touch", platform.touch ? "true" : "false");
    root.setAttribute("data-standalone", platform.standalone ? "true" : "false");
  }, [platform.formFactor, platform.touch, platform.standalone, isMobile]);

  const value = useMemo(() => ({ platform, isMobile }), [platform, isMobile]);
  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformContextValue {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error("usePlatform must be used within a PlatformProvider");
  return ctx;
}
