import { BACKENDS, BROKERS, SCREENS } from "@workspace/backend-catalogue";
import { getSettings, updateSettings, registerCapabilityStatesSanitizer, AI_PROVIDERS, type DeploymentState, type CapabilitySetting } from "./settings";
import { isForbiddenKey } from "./safe-json";
import { validEndpoint } from "./endpoint-probe";
import { recordCapabilityEvent, STATES } from "./capability-log";
// Endpoint validation + reachability probing live in endpoint-probe (network I/O); the activity/audit
// ring + external sink live in capability-log (logging infrastructure). Both are kept out of capability
// resolution and re-exported here so existing importers (routes/tools, tests) are unaffected.
export { validEndpoint, checkEndpointReachable, type EndpointCheck } from "./endpoint-probe";
export { recentCapabilityLog, recentCapabilityLogShared, __resetCapabilityLogSink, type CapabilityLogEntry } from "./capability-log";

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

export type CapabilityKind = "ai-tool" | "mcp" | "ai-provider" | "vendor" | "broker";

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
  { id: "portfolio-insights", kind: "ai-tool", label: "Portfolio AI insights", description: "AI-written status narrative and risk outlook over the portfolio read model. Read-only — describes the numbers, exposes no actions, never writes. Output is labelled AI-generated. Off by default.", supportedStates: ANY, surfaceAware: true },
  { id: "ai-estimate", kind: "ai-tool", label: "AI-assisted estimation", description: "Suggests an effort estimate (points/days) for described work, with a rationale. Advisory only — the human explicitly commits the value; the model never writes or acts. Output is labelled AI-generated. Off by default.", supportedStates: ANY, surfaceAware: true },
  { id: "backend-draft", kind: "ai-tool", label: "AI backend-draft suggestions", description: "Draft a starting-point backend definition (name, docs link, auth style, capabilities) from an LLM for an unlisted vendor. Training-knowledge only — no live verification; an admin still reviews and maps real actions.", supportedStates: ANY, surfaceAware: true },
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

/** Build a `GovernedCapability[]` from a catalogue array — the identical shape
 *  provider/vendor/broker capabilities share, differing only in the id prefix, the kind,
 *  and how each item is described. */
function toCapability<T>(
  prefix: string,
  kind: CapabilityKind,
  items: readonly T[],
  describe: (item: T) => { id: string; label: string; description: string; supportedStates: DeploymentState[] },
): GovernedCapability[] {
  return items.map((item) => {
    const d = describe(item);
    return { id: `${prefix}:${d.id}`, kind, label: d.label, description: d.description, supportedStates: d.supportedStates, surfaceAware: true };
  });
}

function providerCapabilities(): GovernedCapability[] {
  return toCapability("provider", "ai-provider", AI_PROVIDERS.filter((p) => PROVIDER_STATES[p]), (p) => ({
    id: p,
    label: `AI provider — ${p}`,
    description: PROVIDER_STATES[p]!.includes("public") ? "A third-party LLM API." : "A local / self-hosted LLM runtime.",
    supportedStates: PROVIDER_STATES[p]!,
  }));
}

function vendorCapabilities(): GovernedCapability[] {
  // Derived from the backend catalogue. Most backends can be self-hosted (user-defined)
  // or used as SaaS (public); the admin picks the actual state per deployment.
  return toCapability("vendor", "vendor", BACKENDS, (b) => ({
    id: b.id,
    label: `Vendor — ${b.label}`,
    description: `Connect ${b.label} as a backend.`,
    supportedStates: ANY,
  }));
}

function brokerCapabilities(): GovernedCapability[] {
  // The broker seam (n8n by default). Self-hosted/in-cluster brokers are user-defined;
  // a managed broker is public. Same tri-state as everything else.
  return toCapability("broker", "broker", BROKERS, (b) => ({
    id: b.id,
    label: `Broker — ${b.label}`,
    description: `Route backend traffic through ${b.label}.`,
    supportedStates: ANY,
  }));
}

/** Speech-to-text engines, governed like AI providers. "browser" runs on the device
 *  (local, zero audio egress); "whisper" sends audio to a configured endpoint. */
function sttCapabilities(): GovernedCapability[] {
  return [
    { id: "stt:browser", kind: "ai-provider", label: "STT — device (local)", description: "The browser's own speech recogniser. Audio never leaves the device.", supportedStates: ["user-defined"], surfaceAware: true },
    { id: "stt:whisper", kind: "ai-provider", label: "STT — Whisper", description: "An OpenAI-compatible Whisper endpoint (self-hosted or cloud). Sends audio off-device.", supportedStates: ANY, surfaceAware: true },
  ];
}

/** Every governed capability across all kinds. */
export function listCapabilities(): GovernedCapability[] {
  return [...AI_TOOLS, MCP_CAPABILITY, ...providerCapabilities(), ...sttCapabilities(), ...brokerCapabilities(), ...vendorCapabilities()];
}

const byId = new Map(listCapabilities().map((c) => [c.id, c]));

/** Look up a capability by id. */
export function getCapability(id: string): GovernedCapability | undefined {
  return byId.get(id);
}

// Teach lib/settings how to sanitize the whole capabilityStates map on the bulk-PATCH / config-restore
// path, using THIS module's catalogue + per-entry sanitizer (settings can't import them eagerly without
// an init-time cycle). Every entry gets the same guards the dedicated setCapabilityState route applies:
// forbidden/unknown keys dropped, state clamped to the capability's supportedStates, endpoint URL-checked.
registerCapabilityStatesSanitizer((states) => {
  const clean: Record<string, CapabilitySetting> = {};
  for (const [id, setting] of Object.entries(states)) {
    if (isForbiddenKey(id)) continue;      // no __proto__/constructor keys into the stored map
    const cap = getCapability(id);
    if (!cap) continue;                    // drop states addressed to an unknown capability id
    clean[id] = sanitizeCapabilitySetting(cap, setting);
  }
  return clean;
});

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

/** Resolve a single capability's effective state for a surface (the runtime check).
 *  Default is OFF for everything — no AI, no brokered/vendor traffic — until an admin
 *  explicitly turns a capability on. Secure (and silent) by default. */
export function effectiveState(id: string, surface?: string): DeploymentState {
  const cap = getCapability(id);
  if (!cap) return "off";
  return resolveState(cap, getSettings().capabilityStates[id], surface);
}

/** Governable surfaces (screens) from the registry — drives the admin override picker. */
export function listSurfaces(): { id: string; label: string }[] {
  return SCREENS.map((s) => ({ id: s.id, label: s.label }));
}

/**
 * Normalise a client-supplied surface (which may be a route path like "/reports") to
 * a canonical screen id from the registry, so per-surface overrides always match. An
 * already-valid screen id passes through; an unknown surface returns undefined (so the
 * global state applies). This is how governance surfaces are wired to the screen registry.
 */
export function screenIdForRoute(input?: string): string | undefined {
  if (!input) return undefined;
  if (SCREENS.some((s) => s.id === input)) return input;
  const norm = (r: string): string => r.replace(/\/+$/, "") || "/";
  const path = norm((input.split(/[?#]/)[0] ?? "/") || "/");
  const exact = SCREENS.find((s) => norm(s.route) === path);
  if (exact) return exact.id;
  const suffix = SCREENS.filter((s) => norm(s.route) !== "/").find((s) => path.endsWith(norm(s.route)));
  return suffix?.id;
}

export interface Actor {
  sub?: string | undefined;
  email?: string | undefined;
  role?: string | undefined;
}

export interface CapabilityDecision {
  id: string;
  kind: CapabilityKind | null;
  surface: string | null;
  state: DeploymentState;
  /** Usable here (state is not "off"). */
  allowed: boolean;
  /** For a user-defined capability, the customer endpoint to call. */
  endpoint: string | null;
}

/** Thrown by enforceCapability when a capability is off for the surface in question. */
export class CapabilityBlockedError extends Error {
  readonly id: string;
  readonly surface: string | null;
  constructor(id: string, surface: string | null) {
    super(`capability "${id}" is turned off${surface ? ` on surface "${surface}"` : ""}`);
    this.name = "CapabilityBlockedError";
    this.id = id;
    this.surface = surface;
  }
}

/**
 * Resolve a capability-use decision for a surface AND record it — to the audit log and
 * the live activity ring — whether allowed or denied, so there's always a trail of
 * which AI/vendor/broker ran where and for whom. The call site uses the returned
 * {state, endpoint} to run correctly.
 */
export function decideCapability(id: string, opts: { surface?: string | undefined; actor?: Actor | null } = {}): CapabilityDecision {
  const cap = getCapability(id);
  const surface = opts.surface ?? null;
  const state = effectiveState(id, opts.surface);
  const allowed = state !== "off";
  const endpoint = state === "user-defined" ? (getSettings().capabilityStates[id]?.endpoint ?? null) : null;
  recordCapabilityEvent({
    auditAction: allowed ? "capability.use" : "capability.blocked",
    logAction: allowed ? "use" : "blocked",
    id, kind: cap?.kind ?? null, surface, state, actor: opts.actor,
    result: allowed ? "success" : "error",
    meta: { capability: id, kind: cap?.kind ?? null, surface, state },
  });
  return { id, kind: cap?.kind ?? null, surface, state, allowed, endpoint };
}

/** Record an admin turning a capability on/off (audited + shown on the dashboard). */
export function noteCapabilityConfigured(id: string, setting: CapabilitySetting, actor?: Actor | null): void {
  const cap = getCapability(id);
  recordCapabilityEvent({
    auditAction: "capability.configured",
    logAction: "configured",
    id, kind: cap?.kind ?? null, surface: null, state: setting.state, actor,
    meta: { capability: id, kind: cap?.kind ?? null, state: setting.state, surfaces: setting.surfaces ?? {} },
  });
}

/**
 * Strong call-time gate: decide + log, and THROW CapabilityBlockedError when the
 * capability is off for this surface. Every governed call site routes through here.
 */
export function enforceCapability(id: string, opts: { surface?: string | undefined; actor?: Actor | null } = {}): CapabilityDecision {
  const decision = decideCapability(id, opts);
  if (!decision.allowed) throw new CapabilityBlockedError(id, decision.surface);
  return decision;
}

/** Coerce an admin's input for one capability to a valid, supportable setting. */
export function sanitizeCapabilitySetting(cap: GovernedCapability, input: unknown): CapabilitySetting {
  const o = (input ?? {}) as Record<string, unknown>;
  const wanted = STATES.includes(o["state"] as DeploymentState) ? (o["state"] as DeploymentState) : "off";
  const state: DeploymentState = wanted === "off" || cap.supportedStates.includes(wanted) ? wanted : "off";

  const endpoint = validEndpoint(typeof o["endpoint"] === "string" ? (o["endpoint"] as string) : "");

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
