import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * AI action catalogue client. The catalogue is the SUPERSET of canonical actions; each
 * carries its current approved state. Approving an action makes it *possible* for the AI
 * tools — the in-app gates (governance per-surface, RBAC, write-grants) restrict further.
 */
export interface CatalogueAction {
  action: string;
  label: string;
  description: string;
  write: boolean;
  approved: boolean;
}

/** The full action catalogue annotated with approval state (admin). */
export function useActionCatalogue() {
  return useQuery<{ actions: CatalogueAction[] }>({
    queryKey: ["action-catalogue"],
    queryFn: () => getJson("/api/governance/actions"),
    staleTime: 15_000,
  });
}

/** Approve or revoke one action (admin; step-up gated server-side). */
export async function setActionApproved(action: string, approved: boolean): Promise<void> {
  const res = await fetch("/api/governance/approved", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(approved ? { actions: [action] } : { remove: [action] }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new Error(body.code === "step_up_required" ? "step_up_required" : body.error ?? `Failed (${res.status})`);
  }
}
