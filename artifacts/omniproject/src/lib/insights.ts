import { safeJson, responseError } from "./api";

/** The read-only AI insight kinds the portfolio panel can request. */
export type InsightKind = "status-narrative" | "risk-outlook";

export interface InsightResult {
  kind: InsightKind;
  narrative: string;
  projects: number;
}

/**
 * Portfolio AI-insights client. Requests a read-only, model-written narrative (status or risk)
 * over the scoped portfolio read model. The narrative must be rendered with the AI·GENERATED
 * provenance badge — it is a model's prose over the real numbers, not a backend fact.
 */
export async function fetchInsight(kind: InsightKind, surface?: string): Promise<InsightResult> {
  const res = await fetch("/api/ai/insights", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, ...(surface ? { surface } : {}) }),
  });
  if (!res.ok) throw responseError(res, await safeJson(res), `AI insight failed (${res.status})`);
  return (await res.json()) as InsightResult;
}
