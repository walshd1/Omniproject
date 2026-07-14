import { safeJson, responseError } from "./api";

export type EstimateUnit = "points" | "days";

export interface EstimateSuggestion {
  value: number | null;
  unit: EstimateUnit;
  rationale: string;
  lowConfidence: boolean;
}

/**
 * AI-assisted estimation client. Requests a SUGGESTED effort estimate for described work. The
 * suggestion is advisory — it must be rendered with the AI·GENERATED badge and only applied to a
 * record when a human explicitly commits it. The gateway never writes.
 */
export async function suggestEstimate(subject: string, unit: EstimateUnit, surface?: string): Promise<EstimateSuggestion> {
  const res = await fetch("/api/ai/estimate", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject, unit, ...(surface ? { surface } : {}) }),
  });
  if (!res.ok) throw responseError(res, await safeJson(res), `AI estimate failed (${res.status})`);
  return (await res.json()) as EstimateSuggestion;
}
