/**
 * NL → action client. Plans an instruction into a canonical action (server decides;
 * see the gateway's lib/nl-action), then — on explicit confirm — executes it through the
 * MCP tools/call endpoint, which re-enforces governance, RBAC and the write policy. The
 * planner never auto-runs; a write is always confirmed by the user here.
 */
import { safeJson, responseError } from "./api";

export type ActionPlan =
  | { kind: "action"; tool: string; action: string; args: Record<string, unknown>; write: boolean }
  | { kind: "clarify"; question: string }
  | { kind: "none"; reason: string };

/** Ask the gateway to plan an instruction (no execution). */
export async function planNlAction(text: string, surface?: string): Promise<ActionPlan> {
  const res = await fetch("/api/ai/nl-action", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...(surface ? { surface } : {}) }),
  });
  if (!res.ok) throw responseError(res, await safeJson(res), `Planning failed (${res.status})`);
  return ((await res.json()) as { plan: ActionPlan }).plan;
}

/** Execute a planned tool via MCP tools/call (governance + RBAC + write policy apply). */
export async function executePlannedAction(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch("/api/mcp", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string }; result?: { isError?: boolean; content?: { text?: string }[] } };
  if (body.error) throw new Error(body.error.message ?? "Action failed");
  if (body.result?.isError) throw new Error(body.result.content?.[0]?.text ?? "Action returned an error");
  return body.result;
}
