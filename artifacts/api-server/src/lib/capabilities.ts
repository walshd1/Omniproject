import type { Request } from "express";
import { isN8nConfigured, callN8n, authHeaderFromReq, userContextFromReq } from "./n8n";

/**
 * Capability signal — which data domains the wired backend(s) can populate, so
 * the UI can pre-emptively label available reports/views instead of probing per
 * request. Resolution order:
 *   1. CAPABILITIES env (gateway-declared, authoritative) — comma list of
 *      enabled domains, e.g. "issues,scheduling,portfolio".
 *   2. n8n action `get_capabilities` (when configured) — the workflow declares
 *      what its backends expose; conservative defaults on error.
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

const ALL_ON = Object.fromEntries(CAPABILITY_DOMAINS.map((d) => [d, true])) as Record<CapabilityDomain, boolean>;

// When n8n is configured but doesn't implement get_capabilities, assume only the
// core domains so we don't promise resource/finance reports that aren't wired.
const CONSERVATIVE: Record<CapabilityDomain, boolean> = {
  issues: true,
  scheduling: true,
  portfolio: true,
  resources: false,
  financials: false,
  baseline: false,
  blockers: false,
};

function fromEnv(): Capabilities | null {
  const raw = process.env["CAPABILITIES"]?.trim();
  if (!raw) return null;
  const set = new Set(raw.split(",").map((s) => s.trim().toLowerCase()));
  const enabled = Object.fromEntries(CAPABILITY_DOMAINS.map((d) => [d, set.has(d)])) as Record<CapabilityDomain, boolean>;
  return build("env", enabled);
}

let cache: { value: Capabilities; at: number } | null = null;
const TTL_MS = 60_000;

export async function resolveCapabilities(req: Request): Promise<Capabilities> {
  const env = fromEnv();
  if (env) return env;

  if (!isN8nConfigured) return build("demo", ALL_ON);

  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  try {
    const result = await callN8n<Partial<Record<CapabilityDomain, boolean>>>(
      "get_capabilities",
      {},
      { authHeader: authHeaderFromReq(req), source: "capability_probe", userContext: userContextFromReq(req) },
    );
    const data = result.data;
    const caps =
      data && typeof data === "object"
        ? build("n8n", { ...CONSERVATIVE, ...data })
        : build("n8n", CONSERVATIVE);
    cache = { value: caps, at: Date.now() };
    return caps;
  } catch {
    return build("n8n", CONSERVATIVE);
  }
}
