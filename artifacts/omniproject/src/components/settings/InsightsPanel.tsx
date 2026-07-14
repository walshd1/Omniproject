import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fetchInsight, type InsightKind } from "../../lib/insights";
import { ProvenanceBadge } from "../ProvenanceBadge";
import { ContainmentBadge } from "../ContainmentBadge";

/**
 * Portfolio AI insights — a read-only, model-written status narrative or risk outlook over the
 * portfolio. The narrative sits ON TOP of the deterministic derivations (it explains the real
 * numbers, it never computes or changes them), and is always rendered with the AI·GENERATED
 * provenance badge so it is never mistaken for a backend fact. Off unless an admin enables the
 * `portfolio-insights` capability — until then the endpoint 403s and this panel says so plainly.
 */
const KINDS: { id: InsightKind; label: string }[] = [
  { id: "status-narrative", label: "Status narrative" },
  { id: "risk-outlook", label: "Risk outlook" },
];

export function InsightsPanel() {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [busy, setBusy] = useState<InsightKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const surface = typeof window !== "undefined" ? window.location.pathname : undefined;

  const onRun = async (kind: InsightKind): Promise<void> => {
    setBusy(kind); setError(null); setNarrative(null);
    try {
      const r = await fetchInsight(kind, surface);
      setNarrative(r.narrative);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI insight failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card data-testid="insights-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">Portfolio AI insights <ContainmentBadge /></CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          An AI-written narrative over your portfolio — a plain-language read of health and delivery
          risk. It describes the real numbers; it never changes them, and every answer is labelled
          AI-generated.
        </p>
        <div className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <Button
              key={k.id}
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void onRun(k.id)}
              data-testid={`insight-${k.id}`}
            >
              {busy === k.id ? "Thinking…" : k.label}
            </Button>
          ))}
        </div>
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400" data-testid="insight-error">{error}</p>}
        {narrative && (
          <div className="space-y-1">
            <ProvenanceBadge provenance="generated" />
            <div className="whitespace-pre-wrap rounded border border-border p-2 text-sm" data-testid="insight-narrative">{narrative}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
