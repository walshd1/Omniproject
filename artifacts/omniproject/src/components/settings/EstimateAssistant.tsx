import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { suggestEstimate, type EstimateUnit, type EstimateSuggestion } from "../../lib/estimate";
import { ProvenanceBadge } from "../ProvenanceBadge";
import { ContainmentBadge } from "../ContainmentBadge";

/**
 * AI-assisted estimation — describe a piece of work and get a SUGGESTED effort estimate with a
 * rationale. The suggestion is advisory: it is badged AI·GENERATED and nothing is applied until the
 * human clicks "Use this estimate" (the explicit commit). The model never writes; the committed
 * value is what a PM chooses to carry forward. Off unless an admin enables the `ai-estimate`
 * capability — until then the endpoint 403s and this panel says so plainly.
 */
const UNITS: { id: EstimateUnit; label: string }[] = [
  { id: "points", label: "Story points" },
  { id: "days", label: "Working days" },
];

export function EstimateAssistant() {
  const [subject, setSubject] = useState("");
  const [unit, setUnit] = useState<EstimateUnit>("points");
  const [suggestion, setSuggestion] = useState<EstimateSuggestion | null>(null);
  const [committed, setCommitted] = useState<{ value: number; unit: EstimateUnit } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const surface = typeof window !== "undefined" ? window.location.pathname : undefined;

  const onSuggest = async (): Promise<void> => {
    setBusy(true); setError(null); setSuggestion(null); setCommitted(null);
    try {
      setSuggestion(await suggestEstimate(subject, unit, surface));
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI estimate failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="estimate-assistant">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">AI estimation assistant <ContainmentBadge /></CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Describe a piece of work and get a suggested effort estimate to sanity-check your own. It is
          advisory and labelled AI-generated — nothing is applied until you choose to use it.
        </p>
        <textarea
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. Build the SSO login page with SAML + magic-link fallback"
          aria-label="Work to estimate"
          rows={2}
          className="w-full rounded-md border border-border bg-transparent p-2 text-sm"
        />
        <div className="flex items-center gap-3 text-xs text-muted-foreground" role="radiogroup" aria-label="Estimate unit">
          <span>Unit:</span>
          {UNITS.map((u) => (
            <label key={u.id} className="flex items-center gap-1 cursor-pointer">
              <input type="radio" name="estimate-unit" checked={unit === u.id} onChange={() => setUnit(u.id)} data-testid={`unit-${u.id}`} />
              {u.label}
            </label>
          ))}
          <Button size="sm" disabled={busy || !subject.trim()} onClick={() => void onSuggest()} data-testid="estimate-suggest">
            {busy ? "Thinking…" : "Suggest"}
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400" data-testid="estimate-error">{error}</p>}
        {suggestion && (
          <div className="space-y-1 rounded border border-border p-2">
            <ProvenanceBadge provenance="generated" />
            <p className="text-sm" data-testid="estimate-suggestion">
              {suggestion.value === null
                ? "No estimate — the description is too thin to size responsibly."
                : `Suggested: ${suggestion.value} ${suggestion.unit}${suggestion.lowConfidence ? " (low confidence)" : ""}`}
            </p>
            {suggestion.rationale && <p className="text-xs text-muted-foreground">{suggestion.rationale}</p>}
            {suggestion.value !== null && (
              <Button size="sm" variant="outline" onClick={() => setCommitted({ value: suggestion.value!, unit: suggestion.unit })} data-testid="estimate-use">
                Use this estimate
              </Button>
            )}
          </div>
        )}
        {committed && (
          <p className="text-sm font-medium" data-testid="estimate-committed">
            Using: {committed.value} {committed.unit}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
