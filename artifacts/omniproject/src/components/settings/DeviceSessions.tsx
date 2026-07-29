import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useSessions, revokeSession, revokeOtherSessions, describeDevice, sessionsKey, type DeviceSession } from "../../lib/sessions";

/**
 * Device & active-session inventory — the account-security surface that lets a user see everywhere they're
 * signed in (this browser plus any other devices) and sign a device out, e.g. after losing one. The list and
 * the revoke both hit `/api/auth/sessions*`; the server holds the truth (a best-effort session directory), so
 * this is purely the flow UI. Revoking the CURRENT session logs this browser out — the app's normal
 * unauthenticated redirect then takes over.
 */
export function DeviceSessions() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useSessions();
  const [busy, setBusy] = useState<string | null>(null); // the id being revoked, or "others"

  const refresh = () => qc.invalidateQueries({ queryKey: sessionsKey });
  const fail = (e: unknown, fallback: string) =>
    toast({ title: "ERROR", description: e instanceof Error ? e.message : fallback, variant: "destructive" });

  const signOut = async (s: DeviceSession) => {
    setBusy(s.id);
    try {
      const { current } = await revokeSession(s.id);
      if (current) {
        // We just signed ourselves out — bounce to a fresh load so the app re-authenticates.
        window.location.assign("/");
        return;
      }
      toast({ title: "Device signed out" });
      refresh();
    } catch (e) { fail(e, "Could not sign that device out."); } finally { setBusy(null); }
  };

  const signOutOthers = async () => {
    setBusy("others");
    try {
      const { revoked } = await revokeOtherSessions();
      toast({ title: revoked === 0 ? "No other devices to sign out" : `Signed out ${revoked} other device${revoked === 1 ? "" : "s"}` });
      refresh();
    } catch (e) { fail(e, "Could not sign the other devices out."); } finally { setBusy(null); }
  };

  const sessions = data?.sessions ?? [];
  const others = sessions.filter((s) => !s.current);

  return (
    <Card>
      <CardHeader><CardTitle>Active sessions &amp; devices</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Where you&apos;re signed in. If you don&apos;t recognise a device, sign it out — that session will be
          signed out the next time it&apos;s used.
        </p>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active sessions are being tracked.</p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {describeDevice(s.userAgent)}
                    {s.current && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">This device</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.ip ? `${s.ip} · ` : ""}last active {formatDistanceToNow(s.lastSeen, { addSuffix: true })}
                  </p>
                </div>
                <Button
                  type="button"
                  variant={s.current ? "outline" : "destructive"}
                  size="sm"
                  onClick={() => signOut(s)}
                  disabled={busy !== null}
                >
                  {s.current ? "Sign out" : "Sign out device"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {others.length > 0 && (
          <Button type="button" variant="outline" onClick={signOutOthers} disabled={busy !== null}>
            Sign out all other devices
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
