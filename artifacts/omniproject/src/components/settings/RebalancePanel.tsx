import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fetchRebalance, type RebalanceProposal } from "../../lib/rebalance";
import { executePlannedAction, type ActionPlan } from "../../lib/nl-action";
import { ActionPlanCard } from "../ActionPlanCard";
import { ProvenanceBadge } from "../ProvenanceBadge";
import { ContainmentBadge } from "../ContainmentBadge";

/**
 * Agentic rebalancing — the AI PROPOSES a short list of corrective actions over the portfolio.
 * It never runs anything on its own: each proposal is shown with its rationale and the SAME
 * confirm-before-execute ActionPlanCard the command palette uses, and only executes (through the
 * existing MCP write path, re-gated by role + write-grants + the autonomous-write guard) after an
 * explicit per-action confirmation. The whole plan is badged AI·GENERATED. Off unless an admin
 * enables the separate `ai-autonomous` capability — until then the endpoint 403s.
 */
function toPlan(p: RebalanceProposal): Extract<ActionPlan, { kind: "action" }> {
  return { kind: "action", tool: p.tool, action: p.action, args: p.args, write: p.write };
}

export function RebalancePanel() {
  const [proposals, setProposals] = useState<RebalanceProposal[] | null>(null);
  const [ran, setRan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const surface = typeof window !== "undefined" ? window.location.pathname : undefined;

  const onSuggest = async (): Promise<void> => {
    setBusy(true); setError(null); setProposals(null); setResults({}); setRan(false);
    try {
      const plan = await fetchRebalance(surface);
      setProposals(plan.proposals);
      setRan(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI rebalancing failed");
    } finally {
      setBusy(false);
    }
  };

  const onRun = async (key: string, p: RebalanceProposal): Promise<void> => {
    // The per-action confirm has already fired inside ActionPlanCard; this is the actual execute,
    // which still passes through role + write-grant + autonomous-guard re-enforcement server-side.
    setRunning(key); setError(null);
    try {
      const r = await executePlannedAction(p.tool, p.args);
      setResults((prev) => ({ ...prev, [key]: typeof r === "string" ? r : "Done." }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setRunning(null);
    }
  };

  return (
    <Card data-testid="rebalance-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">AI rebalancing <ContainmentBadge /></CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Ask the AI to propose corrective actions over the portfolio. Nothing runs on its own —
          each suggestion is AI-generated, constrained to your approved actions, and executes only
          after you review and confirm it individually.
        </p>
        <Button size="sm" disabled={busy} onClick={() => void onSuggest()} data-testid="rebalance-suggest">
          {busy ? "Thinking…" : "Suggest rebalancing"}
        </Button>
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400" data-testid="rebalance-error">{error}</p>}
        {ran && proposals && proposals.length === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="rebalance-empty">No rebalancing actions suggested — the portfolio looks balanced.</p>
        )}
        {proposals && proposals.length > 0 && (
          <div className="space-y-3">
            <ProvenanceBadge provenance="generated" />
            {proposals.map((p, i) => {
              const key = `${p.action}-${i}`;
              return (
                <div key={key} className="space-y-1" data-testid={`rebalance-proposal-${i}`}>
                  <p className="text-xs text-muted-foreground">{p.reason}</p>
                  {results[key]
                    ? <p className="text-sm font-medium" data-testid={`rebalance-result-${i}`}>{results[key]}</p>
                    : <ActionPlanCard plan={toPlan(p)} busy={running === key} onRun={() => void onRun(key, p)} testIdPrefix={`rebalance-${i}`} />}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
