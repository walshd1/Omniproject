import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * Client view of capability governance (see the gateway's lib/tools). Every AI tool,
 * the MCP, AI providers and vendors are set by an admin to off / user-defined (the
 * customer controls it — local or their own remote endpoint) / public (SaaS). A
 * capability offers only the states it supports, and AI tools can be set per surface
 * (screen). All admin-gated; all stored in customer-level JSON.
 */
export type DeploymentState = "off" | "user-defined" | "public";
export type CapabilityKind = "ai-tool" | "mcp" | "ai-provider" | "vendor";

export interface ResolvedCapability {
  id: string;
  kind: CapabilityKind;
  label: string;
  description: string;
  supportedStates: DeploymentState[];
  surfaceAware: boolean;
  /** The states to offer in the UI ("off" + whatever it supports). */
  options: DeploymentState[];
  /** Its current global state. */
  state: DeploymentState;
  /** Customer endpoint for a user-defined capability. */
  endpoint: string | null;
  /** Per-surface overrides (AI tools only): screen id → state. */
  surfaces: Record<string, DeploymentState>;
}

export interface CapabilityWrite {
  state: DeploymentState;
  endpoint?: string | null;
  surfaces?: Record<string, DeploymentState>;
}

interface GovernanceResponse {
  capabilities: ResolvedCapability[];
}

/** Plain-language description of each state — what the admin is choosing. */
export const STATE_INFO: Record<DeploymentState, { label: string; blurb: string; tone: "muted" | "safe" | "warn" }> = {
  off: { label: "Off", blurb: "Not used.", tone: "muted" },
  "user-defined": {
    label: "User-defined",
    blurb: "Runs where you control it — truly local, or your own remote endpoint. Data stays within your organisation.",
    tone: "safe",
  },
  public: {
    label: "Public",
    blurb: "A third-party cloud service. Data leaves your organisation — don't use it for information that may not.",
    tone: "warn",
  },
};

/** Human label for a capability kind (used for grouping). */
export const KIND_LABEL: Record<CapabilityKind, string> = {
  "ai-tool": "AI tools",
  mcp: "MCP",
  "ai-provider": "AI providers",
  vendor: "Vendors",
};

/** Load every governed capability with its offered states + current setting. */
export function useGovernance() {
  return useQuery<GovernanceResponse>({
    queryKey: ["governance"],
    queryFn: () => getJson("/api/governance"),
    staleTime: 30_000,
  });
}

/** Persist one capability's setting (admin only; the gateway enforces the role). */
export async function saveCapability(id: string, setting: CapabilityWrite): Promise<void> {
  await fetch(`/api/governance/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(setting),
  });
}
