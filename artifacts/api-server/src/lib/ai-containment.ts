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

/** Strictness ordering — public is the most contained, off the least. */
const STRICTNESS: Record<AiContainment, number> = { off: 0, local: 1, remote: 2, public: 3 };
const strictest = (a: AiContainment, b: AiContainment): AiContainment => (STRICTNESS[a] >= STRICTNESS[b] ? a : b);

/** The EXPOSURE level implied by the configured AI provider + its governance state — i.e.
 *  WHERE the AI runs, the hard floor below which containment can never be relaxed. */
export function aiSourceLevel(surface?: string): AiContainment {
  const provider = getSettings().aiProvider;
  if (!provider || provider === "none") return "off";
  const id = `provider:${provider}`;
  let state: ReturnType<typeof effectiveState>;
  try { state = effectiveState(id, surface); } catch { return "public"; }
  if (state === "off") return "off";
  if (state === "public") return "public";
  const endpoint = getSettings().capabilityStates?.[id]?.endpoint ?? null;
  return classifyEndpointLocality(endpoint);
}

// The admin RELAX floor. Default "public" ⇒ FULL containment for ALL sources, regardless
// of where the AI runs. An admin lowers this to deliberately relax; even then the source
// level is also a floor, so a remote/public AI stays maximally contained.
let relaxFloor: AiContainment = "public";

/** Relax the default-full containment toward `level` (admin). Source floor still applies. */
export function setContainmentRelax(level: AiContainment): void { relaxFloor = level; }
/** The current admin relax floor (default "public" = full containment). */
export function getContainmentRelax(): AiContainment { return relaxFloor; }
/** Test-only: restore the default-full posture. */
export function __resetContainmentRelax(): void { relaxFloor = "public"; }

/**
 * The ENFORCED containment level: the strictest of the admin relax floor (default full)
 * and the AI source level. So by default every source is fully contained; an admin can
 * relax, but never below what the AI's exposure warrants.
 */
export function aiContainmentLevel(surface?: string): AiContainment {
  return strictest(relaxFloor, aiSourceLevel(surface));
}
