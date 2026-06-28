import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * Client view of the tools plane (see the gateway's lib/tools). A tool is usable only
 * if the admin's data-egress policy permits it, and any non-local egress needs the
 * user's one-time, informed consent — surfaced by ToolConsentDialog. Every tool offers
 * a local path by hard rule, so "lock it down by default" never means "no tools".
 */
export type EgressClass = "none" | "self-hosted" | "third-party";

export interface ResolvedTool {
  id: string;
  label: string;
  description: string;
  egressModes: EgressClass[];
  available: boolean;
  effectiveEgress: EgressClass | null;
  requiresConsent: boolean;
  consented: boolean;
  reason: string | null;
}

export interface ToolPolicy {
  allowedEgress: EgressClass[];
  disabled: string[];
}

interface ToolsResponse {
  tools: ResolvedTool[];
  policy: ToolPolicy;
}

/** Plain-language description of each egress class — what the user is consenting to. */
export const EGRESS_INFO: Record<EgressClass, { label: string; blurb: string; tone: "safe" | "caution" | "warn" }> = {
  none: {
    label: "On your device",
    blurb: "Runs entirely in your browser. No data leaves this device.",
    tone: "safe",
  },
  "self-hosted": {
    label: "Your own infrastructure",
    blurb: "Sends data to a service your organisation runs (e.g. your own Ollama or Whisper server). It stays within your infrastructure.",
    tone: "caution",
  },
  "third-party": {
    label: "Third-party cloud",
    blurb: "Sends data to an external provider (e.g. OpenAI). Don't use it for information that isn't permitted to leave your organisation.",
    tone: "warn",
  },
};

/** Load the tools resolved for the current user (availability + consent state). */
export function useTools() {
  return useQuery<ToolsResponse>({
    queryKey: ["tools"],
    queryFn: () => getJson("/api/tools"),
    staleTime: 30_000,
  });
}

/** Record the current user's consent for a tool. */
export async function consentToTool(id: string): Promise<void> {
  await fetch(`/api/tools/${encodeURIComponent(id)}/consent`, { method: "POST", credentials: "same-origin" });
}

/** Withdraw the current user's consent for a tool. */
export async function revokeToolConsent(id: string): Promise<void> {
  await fetch(`/api/tools/${encodeURIComponent(id)}/consent`, { method: "DELETE", credentials: "same-origin" });
}

/** Persist the admin data-egress policy (admin only; the gateway enforces the role). */
export async function saveToolPolicy(policy: ToolPolicy): Promise<void> {
  await fetch("/api/tools/policy", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(policy),
  });
}
