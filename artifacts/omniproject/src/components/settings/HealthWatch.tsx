import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useHealthFindings, runHealthWatch, type HealthFinding } from "../../lib/health-watch";

/**
 * Health / anomaly watch. A manager+ sees the recent findings; an admin can trigger a
 * scan. The scan runs server-side as the keyed `automation:health-watch` actor (read-only)
 * and raises a notification per finding.
 */
const SEV_CLS: Record<HealthFinding["severity"], string> = {
  critical: "bg-red-100 text-red-800",
  warning: "bg-amber-100 text-amber-800",
  info: "bg-muted text-muted-foreground",
};

export function HealthWatch() {
  const { data: auth } = useAuth();
  const qc = useQueryClient();
  const { data } = useHealthFindings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!roleAtLeast(auth?.role, "manager")) return null;
  const isAdmin = roleAtLeast(auth?.role, "admin");
  const findings = [...(data?.findings ?? [])].reverse(); // newest first

  const onRun = async (): Promise<void> => {
    setBusy(true); setError(null);
    try { await runHealthWatch(); await qc.invalidateQueries({ queryKey: ["health-findings"] }); }
    catch (e) { setError(e instanceof Error ? e.message : "Scan failed"); }
    finally { setBusy(false); }
  };

  return (
    <Card data-testid="health-watch">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          Health &amp; anomaly watch
          {isAdmin && <Button size="sm" variant="outline" disabled={busy} onClick={() => void onRun()} data-testid="health-run">{busy ? "Scanning…" : "Run scan"}</Button>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          KPI rules over the portfolio (RAG, schedule slip, budget overrun, blockers).
          Scans run as a keyed, read-only automation and raise a notification per finding.
        </p>
        {error && <p className="text-sm text-red-600" data-testid="health-error">{error}</p>}
        {findings.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="health-clear">No findings — the portfolio is healthy (or no scan has run).</p>
        ) : (
          <ul className="space-y-1 text-sm" data-testid="health-findings">
            {findings.map((f, i) => (
              <li key={`${f.projectId}-${f.ruleId}-${i}`} className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${SEV_CLS[f.severity]}`}>{f.severity}</span>
                <span className="font-medium">{f.projectName}</span>
                <span className="text-muted-foreground">{f.message}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
