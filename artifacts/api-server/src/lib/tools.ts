import { getSettings, updateSettings, type EgressClass, type ToolPolicy } from "./settings";

/**
 * The Tool Registry — the governance substrate every optional tool (AI dictation,
 * NL→action, health watch, portfolio copilot, …) plugs into.
 *
 * The product's posture is "lock it down, let people relax it with information": a
 * tool is usable only if its data-egress is within the admin's policy, and any
 * non-local egress additionally needs that user's one-time, informed consent. By a
 * HARD RULE (enforced in tools.test.ts) every tool must offer at least one LOCAL
 * mode — on-device ("none") or on the customer's own infra ("self-hosted") — so no
 * capability is ever cloud-only. Third-party cloud is always an additional, opt-in
 * choice, never the only one.
 */

export interface ToolDescriptor {
  id: string;
  label: string;
  description: string;
  /** The egress modes this tool can run in. At least one MUST be local (see above). */
  egressModes: EgressClass[];
}

/**
 * The tools. Their implementations land in later increments; the registry governs
 * them from day one. Each lists every egress mode it can run in — the resolver picks
 * the most local one the policy permits.
 */
export const TOOLS: ToolDescriptor[] = [
  {
    id: "whisper-dictation",
    label: "Voice dictation (Whisper)",
    description: "Speech-to-text into any field. On-device (in-browser WASM), the customer's own Whisper server, or a cloud API.",
    egressModes: ["none", "self-hosted", "third-party"],
  },
  {
    id: "nl-action",
    label: "Natural-language actions",
    description: "Turn a typed/spoken instruction into a canonical action (e.g. \"create a task in X due Friday\") via an LLM.",
    egressModes: ["self-hosted", "third-party"],
  },
  {
    id: "health-watch",
    label: "Health & anomaly watch",
    description: "Flags slipping projects, budget overruns and SLA breaches. Rules-only on-device, or AI-assisted.",
    egressModes: ["none", "self-hosted", "third-party"],
  },
  {
    id: "portfolio-copilot",
    label: "Portfolio copilot",
    description: "Natural-language questions and exec summaries over the live portfolio, via an LLM.",
    egressModes: ["self-hosted", "third-party"],
  },
];

/** The default, locked-down policy: on-device tools only until an admin relaxes it. */
export const DEFAULT_TOOL_POLICY: ToolPolicy = { allowedEgress: ["none"], disabled: [] };

const EGRESS_RANK: Record<EgressClass, number> = { none: 0, "self-hosted": 1, "third-party": 2 };
const EGRESS_CLASSES: readonly EgressClass[] = ["none", "self-hosted", "third-party"];

/** The most-local egress mode in a list (none < self-hosted < third-party), or null. */
export function lowestEgress(modes: readonly EgressClass[]): EgressClass | null {
  let best: EgressClass | null = null;
  for (const m of modes) if (best === null || EGRESS_RANK[m] < EGRESS_RANK[best]) best = m;
  return best;
}

export interface ResolvedTool extends ToolDescriptor {
  /** Usable for this user right now (policy permits a mode + admin hasn't disabled it). */
  available: boolean;
  /** The egress mode it would run in (most local the policy permits), or null if blocked. */
  effectiveEgress: EgressClass | null;
  /** Needs a one-time consent before first use (its effective egress leaves the device). */
  requiresConsent: boolean;
  /** Whether the asking user has already consented. */
  consented: boolean;
  /** Why it is unavailable, if it is (for the UI). */
  reason: string | null;
}

/** Resolve one tool against the admin policy and a user's prior consent. */
export function resolveTool(tool: ToolDescriptor, policy: ToolPolicy, consentedIds: readonly string[]): ResolvedTool {
  const consented = consentedIds.includes(tool.id);
  if (policy.disabled.includes(tool.id)) {
    return { ...tool, available: false, effectiveEgress: null, requiresConsent: false, consented, reason: "switched off by your administrator" };
  }
  const effectiveEgress = lowestEgress(tool.egressModes.filter((m) => policy.allowedEgress.includes(m)));
  if (effectiveEgress === null) {
    return { ...tool, available: false, effectiveEgress: null, requiresConsent: false, consented, reason: "blocked by the data-egress policy" };
  }
  const requiresConsent = effectiveEgress !== "none" && !consented;
  return { ...tool, available: true, effectiveEgress, requiresConsent, consented, reason: null };
}

/** Resolve every tool for a given policy + user consent set. */
export function listResolvedTools(policy: ToolPolicy, consentedIds: readonly string[]): ResolvedTool[] {
  return TOOLS.map((t) => resolveTool(t, policy, consentedIds));
}

/** Is this a known tool id? */
export function isKnownTool(id: string): boolean {
  return TOOLS.some((t) => t.id === id);
}

/** Coerce untrusted input to a valid policy. "none" is always kept (it never leaves). */
export function sanitizeToolPolicy(input: unknown): ToolPolicy {
  const o = (input ?? {}) as Record<string, unknown>;
  const rawAllowed = Array.isArray(o["allowedEgress"]) ? (o["allowedEgress"] as unknown[]) : [];
  const allowed = rawAllowed.filter((x): x is EgressClass => EGRESS_CLASSES.includes(x as EgressClass));
  const disabled = (Array.isArray(o["disabled"]) ? (o["disabled"] as unknown[]) : []).filter(
    (x): x is string => typeof x === "string" && isKnownTool(x),
  );
  return { allowedEgress: Array.from(new Set<EgressClass>(["none", ...allowed])), disabled: Array.from(new Set(disabled)) };
}

/** The current admin policy. */
export function getToolPolicy(): ToolPolicy {
  return getSettings().toolPolicy;
}

/** Persist a (sanitised) admin policy; returns what was stored. */
export function setToolPolicy(input: unknown): ToolPolicy {
  const clean = sanitizeToolPolicy(input);
  updateSettings({ toolPolicy: clean });
  return clean;
}

/** Tool ids a user has consented to. */
export function getConsentedTools(sub: string): string[] {
  return getSettings().toolConsent[sub] ?? [];
}

/** Record a user's consent for a tool (idempotent); returns their full consent set. */
export function addToolConsent(sub: string, toolId: string): string[] {
  const current = getConsentedTools(sub);
  if (current.includes(toolId)) return current;
  const next = [...current, toolId];
  updateSettings({ toolConsent: { ...getSettings().toolConsent, [sub]: next } });
  return next;
}

/** Withdraw a user's consent for a tool; returns their remaining consent set. */
export function revokeToolConsent(sub: string, toolId: string): string[] {
  const next = getConsentedTools(sub).filter((id) => id !== toolId);
  updateSettings({ toolConsent: { ...getSettings().toolConsent, [sub]: next } });
  return next;
}
