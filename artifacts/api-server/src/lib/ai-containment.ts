import { getSettings } from "./settings";
import { effectiveState } from "./tools";

/**
 * AI exposure → containment level.
 *
 * The more EXPOSED the AI that can drive autonomous behaviour, the tighter the leash on
 * what an autonomous actor may do. The principle (operator's): if AI is a remote endpoint
 * or public, demand maximum constraint — many narrow grants, never one broad one — and
 * even on local, prefer granular.
 *
 *   - "off"    : AI is governance-off — no AI can drive an actor, so no extra constraint.
 *   - "local"  : AI is user-defined against a LOCAL endpoint (localhost / private network).
 *   - "remote" : AI is user-defined against a customer-owned REMOTE endpoint.
 *   - "public" : AI is a public/SaaS provider — the most exposed, the most constrained.
 *
 * Unknown/indeterminate states resolve to "public" (fail to the strictest level).
 */
export type AiContainment = "off" | "local" | "remote" | "public";

/** Is a host on the local machine or a private network (RFC1918 / loopback / .local)? */
export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "::1" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "127.0.0.1" || h.startsWith("127.")) return true;
  if (h.startsWith("10.") || h.startsWith("192.168.")) return true;
  const m = /^172\.(\d+)\./.exec(h);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}

/** Classify a user-defined endpoint as local or remote (no endpoint ⇒ remote, i.e. stricter). */
export function classifyEndpointLocality(endpoint: string | null | undefined): "local" | "remote" {
  if (!endpoint) return "remote";
  try { return isLocalHost(new URL(endpoint).host) ? "local" : "remote"; }
  catch { return "remote"; }
}

/** The containment level implied by the currently-configured AI provider + its governance state. */
export function aiContainmentLevel(surface?: string): AiContainment {
  const provider = getSettings().aiProvider;
  if (!provider || provider === "none") return "off";
  const id = `provider:${provider}`;
  let state: ReturnType<typeof effectiveState>;
  try { state = effectiveState(id, surface); } catch { return "public"; }
  if (state === "off") return "off";
  if (state === "public") return "public";
  // user-defined: local vs remote by the configured endpoint.
  const endpoint = getSettings().capabilityStates?.[id]?.endpoint ?? null;
  return classifyEndpointLocality(endpoint);
}
