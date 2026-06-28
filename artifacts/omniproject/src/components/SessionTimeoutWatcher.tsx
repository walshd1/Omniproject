import { useEffect, useRef, useState } from "react";
import { useAuth, logout } from "../lib/auth";
import { Button } from "@/components/ui/button";

/**
 * Idle session-timeout watcher (the client half of the server's sliding timeout).
 * Tracks real user activity; on activity it pings the gateway (throttled) to slide the
 * server's `seen` forward, so an active user stays signed in. When the user has been
 * idle to within `WARN_MS` of the limit it shows a countdown; at the limit it signs
 * out and returns to login — limiting unattended-session / shoulder-surfing risk.
 */
const WARN_MS = 60_000; // warn this long before the idle limit
const TICK_MS = 1_000;
const PING_THROTTLE_MS = 60_000; // refresh the server session at most this often

export function SessionTimeoutWatcher() {
  const { data: auth } = useAuth();
  const idleMs = auth?.authenticated ? auth.sessionTimeout?.idleMs ?? 0 : 0;
  const [remaining, setRemaining] = useState<number | null>(null);
  const lastActivity = useRef(Date.now());
  const lastPing = useRef(0);

  useEffect(() => {
    if (idleMs <= 0) return; // disabled or signed out

    const onActivity = (): void => {
      lastActivity.current = Date.now();
      // Keep the server session alive on genuine activity (throttled).
      if (Date.now() - lastPing.current > PING_THROTTLE_MS) {
        lastPing.current = Date.now();
        void fetch("/api/auth/me", { credentials: "same-origin" }).catch(() => {});
      }
    };
    const events = ["mousedown", "keydown", "pointerdown", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));

    const timer = setInterval(() => {
      const left = idleMs - (Date.now() - lastActivity.current);
      if (left <= 0) {
        clearInterval(timer);
        void logout();
      } else {
        setRemaining(left <= WARN_MS ? left : null);
      }
    }, TICK_MS);

    return () => {
      clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [idleMs]);

  if (remaining === null) return null;

  const secs = Math.ceil(remaining / 1000);
  return (
    <div
      role="alertdialog"
      aria-label="Session about to expire"
      data-testid="session-timeout-warning"
      className="fixed bottom-4 left-1/2 z-[10000] -translate-x-1/2 rounded-lg border border-amber-500/60 bg-background px-4 py-3 shadow-lg"
    >
      <p className="text-sm font-medium">Signing you out in {secs}s for inactivity.</p>
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => void logout()}>Sign out now</Button>
        <Button size="sm" onClick={() => { lastActivity.current = Date.now(); setRemaining(null); void fetch("/api/auth/me", { credentials: "same-origin" }).catch(() => {}); }}>Stay signed in</Button>
      </div>
    </div>
  );
}
