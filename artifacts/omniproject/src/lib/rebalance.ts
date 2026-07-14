import { safeJson, responseError } from "./api";

export interface RebalanceProposal {
  action: string;
  tool: string;
  args: Record<string, unknown>;
  write: boolean;
  reason: string;
}

export interface RebalancePlan {
  proposals: RebalanceProposal[];
  considered: number;
  projects: number;
}

/**
 * Agentic rebalancing client. Requests a set of PROPOSED corrective actions over the portfolio.
 * The gateway never executes them — each proposal is rendered as the shared confirm-before-execute
 * ActionPlanCard and only runs (through the existing MCP write path + autonomous-guard) after an
 * explicit per-action human confirmation. The whole plan is labelled AI·GENERATED.
 */
export async function fetchRebalance(surface?: string): Promise<RebalancePlan> {
  const res = await fetch("/api/ai/rebalance", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(surface ? { surface } : {}) }),
  });
  if (!res.ok) throw responseError(res, await safeJson(res), `AI rebalancing failed (${res.status})`);
  return (await res.json()) as RebalancePlan;
}
