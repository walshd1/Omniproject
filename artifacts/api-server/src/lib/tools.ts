import { BACKENDS, BROKERS, SCREENS } from "@workspace/backend-catalogue";
import { getSettings, updateSettings, AI_PROVIDERS, type DeploymentState, type CapabilitySetting } from "./settings";
import { recordAudit } from "./audit";
import { isSafeOutboundUrl } from "./url-safety";

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

function brokerCapabilities(): GovernedCapability[] {
  // The broker seam (n8n by default). Self-hosted/in-cluster brokers are user-defined;
  // a managed broker is public. Same tri-state as everything else.
  return BROKERS.map((b) => ({
    id: `broker:${b.id}`,
    kind: "broker" as const,
    label: `Broker — ${b.label}`,
    description: `Route backend traffic through ${b.label}.`,
    supportedStates: ANY,
    surfaceAware: true,
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

/** Validate a user-defined endpoint: a well-formed http(s) URL, or null. */
export function validEndpoint(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? t.slice(0, 2048) : null;
  } catch {
    return null;
  }
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

export interface EndpointCheck {
  reachable: boolean;
  status?: number;
  error?: string;
}

/** Probe a user-defined endpoint: any HTTP response = reachable; a network error or
 *  timeout = not. Admin-initiated (like the connection test), with a short timeout. */
export async function checkEndpointReachable(url: string, timeoutMs = 3000): Promise<EndpointCheck> {
  const valid = validEndpoint(url);
  if (!valid) return { reachable: false, error: "not a valid http(s) URL" };
  // Don't let the admin reachability-tester be turned into an SSRF probe of cloud metadata.
  if (!isSafeOutboundUrl(valid)) return { reachable: false, error: "blocked: link-local/metadata address" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(valid, { method: "GET", signal: controller.signal });
    return { reachable: true, status: res.status };
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
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

/** One entry in the live capability activity log (for the admin dashboard). */
export interface CapabilityLogEntry {
  ts: string;
  action: "use" | "blocked" | "configured";
  capability: string;
  kind: CapabilityKind | null;
  surface: string | null;
  state: DeploymentState;
  actor: string | null;
}

const LOG_MAX = 200;
const activityLog: CapabilityLogEntry[] = [];

function pushLog(entry: CapabilityLogEntry): void {
  activityLog.push(entry);
  if (activityLog.length > LOG_MAX) activityLog.shift();
}

/** Recent capability activity (uses, blocks, config changes), newest first. */
export function recentCapabilityLog(): CapabilityLogEntry[] {
  return [...activityLog].reverse();
}

const actorLabel = (a?: Actor | null): string | null => a?.email ?? a?.sub ?? null;

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
  recordAudit({
    ts: new Date().toISOString(),
    category: "admin",
    action: allowed ? "capability.use" : "capability.blocked",
    actor: opts.actor ?? null,
    write: true,
    result: allowed ? "success" : "error",
    meta: { capability: id, kind: cap?.kind ?? null, surface, state },
  });
  pushLog({ ts: new Date().toISOString(), action: allowed ? "use" : "blocked", capability: id, kind: cap?.kind ?? null, surface, state, actor: actorLabel(opts.actor) });
  return { id, kind: cap?.kind ?? null, surface, state, allowed, endpoint };
}

/** Record an admin turning a capability on/off (audited + shown on the dashboard). */
export function noteCapabilityConfigured(id: string, setting: CapabilitySetting, actor?: Actor | null): void {
  const cap = getCapability(id);
  recordAudit({
    ts: new Date().toISOString(),
    category: "admin",
    action: "capability.configured",
    actor: actor ?? null,
    write: true,
    meta: { capability: id, kind: cap?.kind ?? null, state: setting.state, surfaces: setting.surfaces ?? {} },
  });
  pushLog({ ts: new Date().toISOString(), action: "configured", capability: id, kind: cap?.kind ?? null, surface: null, state: setting.state, actor: actorLabel(actor) });
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

const STATES: readonly DeploymentState[] = ["off", "user-defined", "public"];

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
