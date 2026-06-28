import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * AI action catalogue client. The catalogue is the SUPERSET of canonical actions; each
 * carries its current approved state and any per-surface/role/backend SCOPE that narrows
 * where it applies. Approving an action makes it *possible* for the AI tools — the in-app
 * gates (governance per-surface, RBAC, write-grants) restrict further.
 */

/** A narrowing on an approved action. Any dimension left empty/undefined = unconstrained. */
export interface ActionScope {
  surfaces?: string[];
  minRole?: string;
  backends?: string[];
}

export interface CatalogueAction {
  action: string;
  label: string;
  description: string;
  write: boolean;
  approved: boolean;
  /** The scope pinned to this action ({} / undefined = global). */
  scope?: ActionScope;
}

/** The full action catalogue annotated with approval state + scope, plus the surface ids
 *  available to scope against (admin). */
export function useActionCatalogue() {
  return useQuery<{ actions: CatalogueAction[]; surfaces?: string[] }>({
    queryKey: ["action-catalogue"],
    queryFn: () => getJson("/api/governance/actions"),
    staleTime: 15_000,
  });
}

async function putApproved(body: unknown): Promise<void> {
  const res = await fetch("/api/governance/approved", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new Error(b.code === "step_up_required" ? "step_up_required" : b.error ?? `Failed (${res.status})`);
  }
}

/** Approve or revoke one action (admin; step-up gated server-side). Approving with no scope
 *  is global. */
export async function setActionApproved(action: string, approved: boolean): Promise<void> {
  await putApproved(approved ? { actions: [action] } : { remove: [action] });
}

/** Set (replace) the per-surface/role/backend scope on an approved action (admin; step-up).
 *  An empty scope widens the action back to global. */
export async function setActionScope(action: string, scope: ActionScope): Promise<void> {
  await putApproved({ rules: [{ action, scope }] });
}
