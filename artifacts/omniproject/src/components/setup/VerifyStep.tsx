import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { verifyWorkflow, type VerifyResult, type SetupStatus } from "../../lib/setup";
import { Dot, Step, TechDetails } from "./shared";

export function VerifyStep({
  isAdmin,
  status,
}: {
  isAdmin: boolean;
  status: SetupStatus | undefined;
}) {
  const { toast } = useToast();

  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  const runVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      setVerifyResult(await verifyWorkflow());
    } catch (e) {
      toast({ title: "Couldn't check", description: e instanceof Error ? e.message : "error", variant: "destructive" });
    } finally {
      setVerifying(false);
    }
  };

  return (
    /* Step 5 — verify workflow */
    <Step n={5} title="Double-check the connection">
      <p className="text-xs text-muted-foreground">
        Run a completely safe check that everything is wired up correctly. This can't change or
        damage anything in your real tool — it only checks the safe, read-only bits, and never
        touches anything that creates, changes, or deletes real data.
      </p>
      <button
        onClick={runVerify}
        disabled={verifying || !isAdmin || !status?.broker.configured}
        className="px-4 py-2 text-xs font-black uppercase tracking-widest border border-primary text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-40 flex items-center gap-2"
      >
        {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
        Run the check
      </button>
      {!status?.broker.configured && (
        <p className="text-xs text-amber-500">Finish step 2 first — connect your tool before checking it.</p>
      )}
      {verifyResult && (
        <div className="border border-border bg-background">
          <div className="p-3 border-b border-border flex items-center justify-between text-sm">
            <span className="font-black uppercase tracking-widest">
              {verifyResult.summary.passed}/{verifyResult.summary.total} actions responding
            </span>
            {verifyResult.summary.verifyAware && <span className="text-[10px] text-green-500 uppercase tracking-widest">verify-aware ✓</span>}
          </div>
          <div className="divide-y divide-border">
            {verifyResult.results.map((r) => (
              <div key={r.action} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                <Dot on={r.ok} />
                <span className="font-mono flex-1">{r.action}</span>
                <span className="text-[11px] text-muted-foreground font-mono">{r.status || "—"} · {r.ms}ms</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground p-3 border-t border-border">{verifyResult.note}</p>
        </div>
      )}
      <TechDetails label="For developers: full contract test from a terminal">
        <p className="text-muted-foreground font-mono">
          OMNI_API_BASE=https://your-omni pnpm --filter @workspace/scripts run verify-broker
        </p>
      </TechDetails>
    </Step>
  );
}
