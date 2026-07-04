import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth, roleAtLeast, logout } from "../../lib/auth";
import { useSecurityKeys, revokeKey, revokeUserSessions, useConfigKeyFingerprint, exportConfigBundle, useMaintenance, setMaintenance, type KeyStatus } from "../../lib/security";
import { stepUp, withStepUp } from "../../lib/step-up";
import { useToast } from "@/hooks/use-toast";
import { ConfirmButton } from "../ConfirmButton";

/**
 * Admin key revocation. Retire a compromised signing key (session / provenance / broker)
 * — it rolls to a fresh derived version and everything signed by the old one is rejected
 * (sessions) or flagged untrusted (provenance). Revoking the SESSION key signs everyone
 * out, including you. Also revoke a single user's sessions. Admin-only.
 */
export function SecurityKeys() {
  const { data: auth } = useAuth();
  const qc = useQueryClient();
  const { data } = useSecurityKeys();
  const { data: configFp } = useConfigKeyFingerprint();
  const { data: maintenance } = useMaintenance();
  const { toast } = useToast();
  const [sub, setSub] = useState("");
  const [lockReason, setLockReason] = useState("");
  const [revokeReason, setRevokeReason] = useState("");

  const onToggleMaintenance = async (engage: boolean): Promise<void> => {
    await withStepUp(async () => { await setMaintenance(engage, lockReason); await qc.invalidateQueries({ queryKey: ["maintenance"] }); setLockReason(""); });
  };
  const [exported, setExported] = useState<{ bundle: string; exportKey: string; warning: string } | null>(null);

  if (!roleAtLeast(auth?.role, "admin")) return null;
  if (!data?.keys) return null;

  const onExportConfig = async (): Promise<void> => {
    if (!(await stepUp())) return; // step-up gated
    try { setExported(await exportConfigBundle()); }
    catch { /* surfaced by absence of output */ }
  };

  const onRevoke = async (key: KeyStatus): Promise<void> => {
    const reason = revokeReason;
    setRevokeReason("");
    // Key revocation is step-up gated: obtain a fresh re-auth first (demo confirms in
    // place; OIDC navigates to the IdP and the user retries after returning).
    if (!(await stepUp())) return;
    try {
      await revokeKey(key.name, reason);
      if (key.name === "session") { void logout(); return; }
      await qc.invalidateQueries({ queryKey: ["security-keys"] });
    } catch (e) {
      toast({ title: "Couldn't revoke key", description: e instanceof Error ? e.message : "failed", variant: "destructive" });
    }
  };

  const onRevokeSessions = async (): Promise<void> => {
    try {
      await revokeUserSessions(sub.trim());
      setSub("");
    } catch (e) {
      toast({ title: "Couldn't revoke sessions", description: e instanceof Error ? e.message : "failed", variant: "destructive" });
    }
  };

  return (
    <Card data-testid="security-keys">
      <CardHeader>
        <CardTitle>Security — key revocation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Retire a signing key if it may be compromised. It rotates to a fresh version;
          anything signed by the revoked version is rejected (sessions) or flagged
          untrusted (provenance).
        </p>
        <ul className="space-y-2">
          {data.keys.map((key) => (
            <li key={key.name} className="flex items-center justify-between gap-4 rounded border border-border p-2 text-sm">
              <div>
                <span className="font-mono font-medium">{key.name}</span>{" "}
                <span className="text-xs text-muted-foreground">v{key.version}{key.revokedVersions.length ? ` · revoked ${key.revokedVersions.join(", ")}` : ""}</span>
                {key.lastReason && <p className="text-xs text-muted-foreground">last: {key.lastReason}</p>}
              </div>
              <ConfirmButton
                testId={`revoke-${key.name}`}
                className="inline-flex min-h-8 items-center justify-center rounded-md border [border-color:var(--button-outline)] px-3 text-xs font-medium shadow-xs disabled:pointer-events-none disabled:opacity-50"
                title={`Revoke & rotate the "${key.name}" key?`}
                description={
                  <div className="space-y-2">
                    <p>
                      {key.name === "session" && "This signs EVERYONE out, including you. "}
                      Anything signed by the current version stops verifying (sessions) or is flagged untrusted (provenance).
                    </p>
                    <input
                      value={revokeReason}
                      onChange={(e) => setRevokeReason(e.target.value)}
                      placeholder="Reason (optional)"
                      aria-label={`Reason for revoking the ${key.name} key`}
                      className="h-9 w-full rounded-md border border-border bg-transparent px-2 text-sm text-foreground"
                    />
                  </div>
                }
                confirmLabel="Revoke & rotate"
                onConfirm={() => void onRevoke(key)}
              >
                Revoke &amp; rotate
              </ConfirmButton>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 border-t border-border pt-3">
          <input
            value={sub}
            onChange={(e) => setSub(e.target.value)}
            placeholder="user id (sub)"
            aria-label="User id to revoke sessions for"
            className="h-9 flex-1 rounded-md border border-border bg-transparent px-2 text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!sub.trim()}
            onClick={() => void onRevokeSessions()}
          >
            Revoke user's sessions
          </Button>
        </div>

        {/* Break-glass: read-only maintenance lockdown. */}
        <div className="space-y-2 border-t border-border pt-3" data-testid="maintenance">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              Maintenance lockdown
              {maintenance?.engaged
                ? <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800">READ-ONLY</span>
                : <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">live</span>}
            </span>
            {maintenance?.engaged
              ? <Button variant="outline" size="sm" data-testid="maintenance-release" onClick={() => void onToggleMaintenance(false)}>Lift lockdown</Button>
              : <ConfirmButton
                  testId="maintenance-engage"
                  className="inline-flex min-h-8 items-center justify-center rounded-md border [border-color:var(--button-outline)] px-3 text-xs font-medium shadow-xs"
                  title="Engage read-only maintenance mode?"
                  description="All changes will be blocked (503) until you lift it. Reads keep working, and sign-in + this toggle stay available so you can lift it yourself."
                  confirmLabel="Engage read-only"
                  onConfirm={() => void onToggleMaintenance(true)}
                >
                  Engage read-only
                </ConfirmButton>}
          </div>
          {!maintenance?.engaged && (
            <input
              value={lockReason}
              onChange={(e) => setLockReason(e.target.value)}
              placeholder="reason (shown to users; optional)"
              aria-label="Maintenance reason"
              className="h-9 w-full rounded-md border border-border bg-transparent px-2 text-sm"
            />
          )}
          <p className="text-xs text-muted-foreground">
            Freezes all changes (503) while keeping reads live — for incidents or change windows.
            Sign-in and this toggle stay available so you can lift it. Survives a restart.
            {maintenance?.engaged && maintenance.reason && <> Reason: <span className="font-medium">{maintenance.reason}</span></>}
          </p>
        </div>

        {/* Config-at-rest key: confirm-by-fingerprint + export (to move encrypted files). */}
        <div className="space-y-2 border-t border-border pt-3" data-testid="config-key">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>
              Config encryption key{" "}
              {configFp && <span className="font-mono text-xs text-muted-foreground">#{configFp.fingerprint}</span>}
            </span>
            <ConfirmButton
              testId="export-config-key"
              className="inline-flex min-h-8 items-center justify-center rounded-md border [border-color:var(--button-outline)] px-3 text-xs font-medium shadow-xs"
              title="Export the config bundle?"
              description="The internal key stays put and is rotated; you'll get an encrypted bundle plus a one-time key to carry separately. Move the bundle, keep the key separate."
              confirmLabel="Export"
              onConfirm={() => void onExportConfig()}
            >
              Export bundle
            </ConfirmButton>
          </div>
          <p className="text-xs text-muted-foreground">Config is encrypted at rest. Export re-encrypts a portable bundle under a one-time key (the internal key never leaves and is rotated). Move the bundle, carry the key separately, import on the target.</p>
          {exported && (
            <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-2" data-testid="exported-key">
              <p className="text-xs text-amber-800">{exported.warning}</p>
              <div>
                <div className="text-[11px] font-semibold text-amber-800">One-time key (carry separately)</div>
                <code className="block break-all rounded bg-background p-1 font-mono text-xs">{exported.exportKey}</code>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-amber-800">Encrypted bundle (the file to move)</div>
                <code className="block max-h-24 overflow-auto break-all rounded bg-background p-1 font-mono text-[11px]">{exported.bundle}</code>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
