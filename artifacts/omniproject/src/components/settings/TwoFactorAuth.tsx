import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useTotpStatus, enrolTotp, confirmTotp, disableTotp, qrDataUrl, totpStatusKey } from "../../lib/totp";

/**
 * App-native TOTP two-factor settings — enrol an authenticator app (scan the QR or type the secret), confirm
 * with a code, save the one-time recovery codes, and disable later (proving a current code). Sits alongside
 * the passkey panel; the crypto is entirely server-side (audited `otpauth`), this is just the flow UI.
 */
export function TwoFactorAuth() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: status } = useTotpStatus();
  const [mode, setMode] = useState<"idle" | "enrolling" | "recovery">("idle");
  const [secret, setSecret] = useState("");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const fail = (e: unknown, fallback: string) =>
    toast({ title: "ERROR", description: e instanceof Error ? e.message : fallback, variant: "destructive" });
  const refresh = () => qc.invalidateQueries({ queryKey: totpStatusKey });

  const startEnrol = async () => {
    setBusy(true);
    try {
      const { secret: s, otpauthUrl } = await enrolTotp();
      setSecret(s);
      setQr(await qrDataUrl(otpauthUrl));
      setCode("");
      setMode("enrolling");
    } catch (e) { fail(e, "Could not start enrolment."); } finally { setBusy(false); }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const { recoveryCodes } = await confirmTotp(code.trim());
      setRecovery(recoveryCodes);
      setMode("recovery");
      refresh();
    } catch (e) { fail(e, "That code was not accepted."); } finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await disableTotp({ code: code.trim() });
      setCode("");
      toast({ title: "Two-factor disabled" });
      refresh();
    } catch (e) { fail(e, "Could not disable two-factor."); } finally { setBusy(false); }
  };

  const done = () => { setMode("idle"); setSecret(""); setQr(""); setRecovery([]); refresh(); };

  return (
    <Card>
      <CardHeader><CardTitle>Two-factor (authenticator app)</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {!status ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !status.available ? (
          <p className="text-sm text-muted-foreground">Two-factor is not configured on this instance.</p>
        ) : status.enrolled ? (
          <div className="space-y-3">
            <p className="text-sm">
              Two-factor is <span className="font-semibold text-primary">on</span>.{" "}
              <span className="text-muted-foreground">{status.recoveryRemaining} recovery code{status.recoveryRemaining === 1 ? "" : "s"} left.</span>
            </p>
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="totp-disable-code">Enter a current code to turn it off</Label>
                <Input id="totp-disable-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} className="w-40" placeholder="123456" />
              </div>
              <Button type="button" variant="destructive" onClick={disable} disabled={busy || code.trim().length < 6}>Disable</Button>
            </div>
          </div>
        ) : mode === "enrolling" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Scan this with your authenticator app, or type the key by hand, then enter the 6-digit code it shows.</p>
            {qr && <img src={qr} alt="Two-factor QR code" width={220} height={220} className="border border-border" />}
            <p className="text-xs">Secret: <code className="font-mono break-all">{secret}</code></p>
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="totp-confirm-code">6-digit code</Label>
                <Input id="totp-confirm-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} className="w-40" placeholder="123456" />
              </div>
              <Button type="button" onClick={confirm} disabled={busy || code.trim().length < 6}>Confirm</Button>
              <Button type="button" variant="ghost" onClick={done} disabled={busy}>Cancel</Button>
            </div>
          </div>
        ) : mode === "recovery" ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold">Save your recovery codes</p>
            <p className="text-xs text-muted-foreground">Each works once if you lose your authenticator. They won’t be shown again.</p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
              {recovery.map((c) => <li key={c} className="border border-border px-2 py-1">{c}</li>)}
            </ul>
            <Button type="button" onClick={done}>I’ve saved them</Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Add a second factor with an authenticator app (Google Authenticator, 1Password, …).</p>
            <Button type="button" onClick={startEnrol} disabled={busy}>Enable two-factor</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
