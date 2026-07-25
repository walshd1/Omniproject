import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "../../lib/auth";
import { passkeySupported, enrolPasskey, passkeyStepUp } from "../../lib/passkey";

/**
 * PASSKEY security — enrol a hardware passkey and STEP UP the current session to strong auth. This is what a
 * native (local password) admin uses to unlock admin/PMO when the deployment requires a passkey
 * (LOCAL_ADMIN_REQUIRE_PASSKEY): a local password alone isn't strong auth, so admin actions stay locked until a
 * passkey step-up. Shown to any signed-in user (the same passkey also signs approvals). When the session is
 * already strong, the step-up shows as satisfied.
 */
export function PasskeySecurity() {
  const { data: auth } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState<"enrol" | "stepup" | null>(null);

  if (!auth?.authenticated) return null;
  const supported = passkeySupported();

  const enrol = async (): Promise<void> => {
    if (!supported || busy) return;
    setBusy("enrol");
    try {
      await enrolPasskey(auth.user?.sub ?? "user", "OmniProject");
      toast({ title: "PASSKEY ENROLLED", description: "You can now step up to strong auth with it." });
    } catch (e) {
      toast({ title: "ENROLMENT FAILED", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally { setBusy(null); }
  };

  const stepUp = async (): Promise<void> => {
    if (!supported || busy) return;
    setBusy("stepup");
    try {
      const r = await passkeyStepUp();
      if (r.needsEnrolment) { toast({ title: "NO PASSKEY YET", description: "Enrol a passkey first, then step up.", variant: "destructive" }); return; }
      await qc.invalidateQueries({ queryKey: ["auth", "me"] });
      toast({ title: "STRONG AUTH UNLOCKED", description: "Admin actions are now available for this session." });
    } catch (e) {
      toast({ title: "VERIFICATION FAILED", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally { setBusy(null); }
  };

  return (
    <Card data-testid="passkey-security">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="w-4 h-4" /> Passkey &amp; step-up</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          A passkey is a hardware-bound second factor. Enrol one, then <strong>step up</strong> to unlock admin
          / PMO actions on this session — a local password alone isn't strong enough when the deployment requires
          a passkey. The same passkey also signs approvals.
        </p>
        {auth.strongAuth ? (
          <p className="flex items-center gap-1.5 text-xs text-emerald-600" data-testid="passkey-strong">
            <ShieldCheck className="w-3.5 h-3.5" /> This session already holds strong auth.
          </p>
        ) : (
          <p className="text-xs text-amber-600" data-testid="passkey-weak">
            This session is not strong-auth yet{auth.local ? " (local password)" : ""}. Step up to unlock privileged actions.
          </p>
        )}
        {!supported && <p className="text-xs text-muted-foreground">This browser doesn't support passkeys.</p>}
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={!supported || busy !== null} onClick={() => void enrol()} data-testid="passkey-enrol">
            {busy === "enrol" ? "…" : "Enrol a passkey"}
          </Button>
          <Button type="button" disabled={!supported || busy !== null || auth.strongAuth} onClick={() => void stepUp()} data-testid="passkey-stepup">
            {busy === "stepup" ? "…" : "Step up with passkey"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
