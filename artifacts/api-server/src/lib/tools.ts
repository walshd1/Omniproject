import { BACKENDS } from "@workspace/backend-catalogue";
import { getSettings, updateSettings, AI_PROVIDERS, type DeploymentState, type CapabilitySetting } from "./settings";

/**
 * Capability governance — one model for every "thing that can move data or be turned
 * on/off": AI tools, the MCP, AI providers and vendors.
 *
 * Each capability is set by an admin to one of three states: "off", "user-defined"
 * (the customer controls it — truly local OR a customer-owned remote endpoint) or
 * "public" (third-party SaaS). A capability advertises only the states it CAN run in,
 * so the UI offers just those (a cloud-only provider shows only "public"; a local-only
 * one only "user-defined").
 *
 * Governance is a CAPABILITY × SURFACE matrix: every capability has a global default
 * and can be overridden per surface (screen/context). So e.g. text-to-speech can be
 * public everywhere but "user-defined" or "off" on finance; equally a cloud AI provider
 * or a SaaS vendor can be allowed generally but forced off on a sensitive screen. All
 * states live in customer-level JSON; changing them is admin-gated.
 */

export type CapabilityKind = "ai-tool" | "mcp" | "ai-provider" | "vendor";

export interface GovernedCapability {
  id: string;
  kind: CapabilityKind;
  label: string;
  description: string;
  /** The non-off states this capability can run in. "off" is always available. */
  supportedStates: DeploymentState[];
  /** Whether the state can be overridden per surface (screen/context). True for every
   *  capability — governance is a full capability × surface matrix. */
  surfaceAware: boolean;
}

/** Both customer-controlled and public — the common case for flexible AI tools. */
const ANY: DeploymentState[] = ["user-defined", "public"];

/** The AI tools + the MCP. Surface-aware so each can be tuned per screen. */
const AI_TOOLS: GovernedCapability[] = [
  { id: "dictation", kind: "ai-tool", label: "Voice dictation (speech-to-text)", description: "Dictate into fields. In-browser/your own Whisper, or a cloud STT.", supportedStates: ANY, surfaceAware: true },
  { id: "tts", kind: "ai-tool", label: "Text-to-speech", description: "Read content aloud. On-device/your own voice service, or a cloud one.", supportedStates: ANY, surfaceAware: true },
  { id: "nl-action", kind: "ai-tool", label: "Natural-language actions", description: "Turn an instruction into a canonical action via an LLM.", supportedStates: ANY, surfaceAware: true },
  { id: "health-watch", kind: "ai-tool", label: "Health & anomaly watch", description: "Flags slipping projects / budget / SLA breaches. Rules locally, or AI-assisted.", supportedStates: ANY, surfaceAware: true },
  { id: "portfolio-copilot", kind: "ai-tool", label: "Portfolio copilot", description: "Natural-language questions + summaries over the portfolio, via an LLM.", supportedStates: ANY, surfaceAware: true },
];

const MCP_CAPABILITY: GovernedCapability = {
  id: "mcp", kind: "mcp", label: "MCP server", description: "Model Context Protocol endpoint for external agents.", supportedStates: ANY, surfaceAware: true,
};

/** The state(s) each AI provider can offer (what it actually is). */
const PROVIDER_STATES: Partial<Record<(typeof AI_PROVIDERS)[number], DeploymentState[]>> = {
  ollama: ["user-defined"], // local / self-hosted only
  openai: ["public"],
  anthropic: ["public"],
  openrouter: ["public"],
};

function providerCapabilities(): GovernedCapability[] {
  return AI_PROVIDERS.filter((p) => PROVIDER_STATES[p]).map((p) => ({
    id: `provider:${p}`,
    kind: "ai-provider" as const,
    label: `AI provider — ${p}`,
    description: PROVIDER_STATES[p]!.includes("public") ? "A third-party LLM API." : "A local / self-hosted LLM runtime.",
    supportedStates: PROVIDER_STATES[p]!,
    surfaceAware: true,
  }));
}

function vendorCapabilities(): GovernedCapability[] {
  // Derived from the backend catalogue. Most backends can be self-hosted (user-defined)
  // or used as SaaS (public); the admin picks the actual state per deployment.
  return BACKENDS.map((b) => ({
    id: `vendor:${b.id}`,
    kind: "vendor" as const,
    label: `Vendor — ${b.label}`,
    description: `Connect ${b.label} as a backend.`,
    supportedStates: ANY,
    surfaceAware: true,
  }));
}

/** Every governed capability across all kinds. */
export function listCapabilities(): GovernedCapability[] {
  return [...AI_TOOLS, MCP_CAPABILITY, ...providerCapabilities(), ...vendorCapabilities()];
}

const byId = new Map(listCapabilities().map((c) => [c.id, c]));

/** Look up a capability by id. */
export function getCapability(id: string): GovernedCapability | undefined {
  return byId.get(id);
}

/** The states the UI should offer for a capability: "off" plus whatever it supports. */
export function offeredStates(cap: GovernedCapability): DeploymentState[] {
  return ["off", ...cap.supportedStates];
}

/**
 * The effective state of a capability — optionally on a given surface. Falls back to
 * "off" when unset or when the chosen state isn't one the capability can support.
 */
export function resolveState(cap: GovernedCapability, setting: CapabilitySetting | undefined, surface?: string): DeploymentState {
  let state = setting?.state ?? "off";
  if (surface && cap.surfaceAware && setting?.surfaces && surface in setting.surfaces) {
    state = setting.surfaces[surface]!;
  }
  if (state === "off") return "off";
  return cap.supportedStates.includes(state) ? state : "off";
}

export interface ResolvedCapability extends GovernedCapability {
  /** Admin-offered options for this capability ("off" + its supported states). */
  options: DeploymentState[];
  /** Its globally-set state (no surface applied), clamped to what it supports. */
  state: DeploymentState;
  /** The customer endpoint for a user-defined capability, if set. */
  endpoint: string | null;
  /** Per-surface overrides (AI tools only). */
  surfaces: Record<string, DeploymentState>;
}

/** Resolve one capability against the stored settings (no surface applied). */
export function resolveCapability(cap: GovernedCapability, states: Record<string, CapabilitySetting>): ResolvedCapability {
  const setting = states[cap.id];
  return {
    ...cap,
    options: offeredStates(cap),
    state: resolveState(cap, setting),
    endpoint: setting?.endpoint ?? null,
    surfaces: cap.surfaceAware ? (setting?.surfaces ?? {}) : {},
  };
}

/** Every capability resolved against the current settings. */
export function listResolvedCapabilities(): ResolvedCapability[] {
  const states = getSettings().capabilityStates;
  return listCapabilities().map((c) => resolveCapability(c, states));
}

/** Resolve a single capability's effective state for a surface (the runtime check). */
export function effectiveState(id: string, surface?: string): DeploymentState {
  const cap = getCapability(id);
  if (!cap) return "off";
  return resolveState(cap, getSettings().capabilityStates[id], surface);
}

const STATES: readonly DeploymentState[] = ["off", "user-defined", "public"];

/** Coerce an admin's input for one capability to a valid, supportable setting. */
export function sanitizeCapabilitySetting(cap: GovernedCapability, input: unknown): CapabilitySetting {
  const o = (input ?? {}) as Record<string, unknown>;
  const wanted = STATES.includes(o["state"] as DeploymentState) ? (o["state"] as DeploymentState) : "off";
  const state: DeploymentState = wanted === "off" || cap.supportedStates.includes(wanted) ? wanted : "off";

  const endpointRaw = typeof o["endpoint"] === "string" ? (o["endpoint"] as string).trim() : "";
  const endpoint = endpointRaw ? endpointRaw.slice(0, 2048) : null;

  let surfaces: Record<string, DeploymentState> | undefined;
  if (cap.surfaceAware && o["surfaces"] && typeof o["surfaces"] === "object") {
    surfaces = {};
    for (const [k, v] of Object.entries(o["surfaces"] as Record<string, unknown>)) {
      if (!STATES.includes(v as DeploymentState)) continue;
      const sv = v as DeploymentState;
      if (sv === "off" || cap.supportedStates.includes(sv)) surfaces[k] = sv;
    }
  }
  return { state, endpoint, ...(surfaces ? { surfaces } : {}) };
}

/** Persist an admin's setting for one capability; returns the stored setting. */
export function setCapabilityState(id: string, input: unknown): CapabilitySetting {
  const cap = getCapability(id);
  if (!cap) throw new UnknownCapabilityError(id);
  const clean = sanitizeCapabilitySetting(cap, input);
  updateSettings({ capabilityStates: { ...getSettings().capabilityStates, [id]: clean } });
  return clean;
}

/** Thrown when an unknown capability id is addressed. */
export class UnknownCapabilityError extends Error {
  constructor(id: string) {
    super(`unknown capability: ${id}`);
    this.name = "UnknownCapabilityError";
  }
}
