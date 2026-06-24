import type { Request } from "express";
import { getBroker, contextFromReq } from "../broker";

/**
 * Capability signal — which data domains the wired backend(s) can populate, so
 * the UI can pre-emptively label available reports/views instead of probing per
 * request. Resolution order:
 *   1. CAPABILITIES env (gateway-declared, authoritative) — comma list of
 *      enabled domains, e.g. "issues,scheduling,portfolio".
 *   2. The active broker's capability report (live adapter probes its backend
 *      with conservative defaults on error).
 *   3. Demo defaults — everything (sample data covers all reports).
 */

export const CAPABILITY_DOMAINS = [
  "issues",
  "scheduling",
  "resources",
  "financials",
  "portfolio",
  "baseline",
  "blockers",
  "history",
  "raid",
] as const;

export type CapabilityDomain = (typeof CAPABILITY_DOMAINS)[number];

export interface Capabilities extends Record<CapabilityDomain, boolean> {
  mode: string;
}

function build(mode: string, enabled: Partial<Record<CapabilityDomain, boolean>>): Capabilities {
  const caps = { mode } as Capabilities;
  for (const d of CAPABILITY_DOMAINS) caps[d] = !!enabled[d];
  return caps;
}

function fromEnv(): Capabilities | null {
  const raw = process.env["CAPABILITIES"]?.trim();
  if (!raw) return null;
  const set = new Set(raw.split(",").map((s) => s.trim().toLowerCase()));
  const enabled = Object.fromEntries(CAPABILITY_DOMAINS.map((d) => [d, set.has(d)])) as Record<CapabilityDomain, boolean>;
  return build("env", enabled);
}

/**
 * Resolve which data domains the active backend can populate. Order:
 *   1. CAPABILITIES env (gateway-declared, authoritative).
 *   2. The broker's own capability report — the demo adapter enables everything;
 *      a live adapter probes its backend (with conservative defaults + caching).
 * The `mode` mirrors the active broker.
 */
export async function resolveCapabilities(req: Request): Promise<Capabilities> {
  const env = fromEnv();
  if (env) return env;

  const broker = getBroker();
  const flags = await broker.capabilities(contextFromReq(req)).catch(() => null);
  const enabled = Object.fromEntries(
    CAPABILITY_DOMAINS.map((d) => [d, !!flags?.[d]]),
  ) as Record<CapabilityDomain, boolean>;
  return build(broker.kind, enabled);
}
