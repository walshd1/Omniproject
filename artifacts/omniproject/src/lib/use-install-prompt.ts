import { useCallback, useEffect, useRef, useState } from "react";

/**
 * PWA install-prompt capture (roadmap 2.5). Chromium fires a `beforeinstallprompt` event we can defer and
 * replay behind our own "Install app" affordance (browsers otherwise suppress the native mini-infobar).
 * Safari/iOS never fires it (install is a manual Share → Add to Home Screen), so `canInstall` stays false
 * there — the UI simply doesn't show the button, which is the correct behaviour. Safe in SSR/tests.
 */

/** The non-standard event Chromium dispatches; typed minimally (not in lib.dom yet). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

export interface InstallPrompt {
  /** True once the browser has offered an installability prompt we can replay. */
  canInstall: boolean;
  /** Replay the deferred prompt; resolves with the user's choice (or "unavailable" if none is pending). */
  promptInstall: () => Promise<InstallOutcome>;
}

export function useInstallPrompt(): InstallPrompt {
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPrompt = (e: Event) => {
      e.preventDefault(); // suppress the native infobar; we surface our own button
      deferred.current = e as BeforeInstallPromptEvent;
      setCanInstall(true);
    };
    const onInstalled = () => { deferred.current = null; setCanInstall(false); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<InstallOutcome> => {
    const ev = deferred.current;
    if (!ev) return "unavailable";
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    deferred.current = null;
    setCanInstall(false); // a prompt can only be replayed once
    return outcome;
  }, []);

  return { canInstall, promptInstall };
}
