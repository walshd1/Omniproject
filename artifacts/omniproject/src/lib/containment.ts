import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * AI containment client. Containment is FULL by default for every source — an admin can
 * relax it, but never below the AI's exposure floor (a remote/public AI stays maximally
 * contained). The "level" is the ENFORCED strictness; "source" is where the AI runs.
 */
export type AiContainment = "off" | "local" | "remote" | "public";

export interface AutonomousGrant {
  actorId: string;
  actions: string[];
  projects?: string[];
  surfaces?: string[];
  fields?: string[];
  notAfter?: number;
  maxWrites?: number;
  allowBroad?: boolean;
}

/** ENFORCED-strictness descriptions (shown wherever AI is used). */
export const CONTAINMENT_INFO: Record<AiContainment, { label: string; cls: string; note: string }> = {
  public: { label: "Full containment", cls: "bg-red-100 text-red-800", note: "Maximum constraint: no wildcard scopes; a time bound and write cap are mandatory on every autonomous write grant." },
  remote: { label: "High containment", cls: "bg-amber-100 text-amber-800", note: "No wildcard scopes; a time bound and write cap are mandatory." },
  local: { label: "Standard containment", cls: "bg-emerald-50 text-emerald-700", note: "Grants are granular; a broad scope needs an explicit opt-in." },
  off: { label: "Minimal containment", cls: "bg-muted text-muted-foreground", note: "No extra constraint (relaxed; only applies where the AI source allows)." },
};

/** Where the AI runs (the hard floor for containment). */
export const SOURCE_LABEL: Record<AiContainment, string> = { off: "AI off", local: "local AI", remote: "remote AI", public: "public AI" };

/** The enforced containment level + AI source for a surface (any authed user). */
export function useAiContainment(surface?: string) {
  const q = surface ? `?surface=${encodeURIComponent(surface)}` : "";
  return useQuery<{ level: AiContainment; source: AiContainment }>({
    queryKey: ["ai-containment", surface ?? null],
    queryFn: () => getJson(`/api/ai/containment${q}`),
    staleTime: 30_000,
  });
}

/** Enforced level + source + admin relax floor + active write grants + kill state (admin). */
export function useAutonomousGrants() {
  return useQuery<{ level: AiContainment; source: AiContainment; relax: AiContainment; grants: AutonomousGrant[]; aiKill: boolean }>({
    queryKey: ["autonomous-grants"],
    queryFn: () => getJson("/api/governance/autonomous"),
    staleTime: 15_000,
  });
}

/** Engage/release the global AI kill switch (admin; step-up gated server-side). */
export async function setAiKill(engage: boolean): Promise<void> {
  const res = await fetch("/api/governance/ai-kill", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ engage }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new Error(body.code === "step_up_required" ? "step_up_required" : body.error ?? `Failed (${res.status})`);
  }
}

/** Relax (or re-tighten) the containment floor (admin; step-up gated server-side). */
export async function relaxContainment(level: AiContainment): Promise<void> {
  const res = await fetch("/api/governance/containment", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new Error(body.code === "step_up_required" ? "step_up_required" : body.error ?? `Failed (${res.status})`);
  }
}
