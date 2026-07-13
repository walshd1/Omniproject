import { safeFetch, EgressError } from "./egress";

/**
 * User-defined endpoint validation + reachability probing.
 *
 * Extracted from capability-governance so the network I/O (an egress-guarded outbound probe) lives
 * apart from capability RESOLUTION — a governed capability that points at a customer-owned endpoint is
 * validated + reachability-tested here; the governance module just consumes `validEndpoint`.
 */

/** Validate a user-defined endpoint: a well-formed http(s) URL (capped at 2048 chars), or null. */
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // safeFetch applies the FULL egress guard (literal block + post-DNS recheck + allowlist/residency)
    // AND pins the connection to the validated IPs + re-validates every redirect hop — so the admin
    // reachability-tester can't be turned into an SSRF/DNS-rebind/redirect probe of cloud metadata. A
    // bare `fetch` after a one-shot check would re-resolve at connect time and follow redirects unchecked.
    const res = await safeFetch(valid, { method: "GET", signal: controller.signal });
    return { reachable: true, status: res.status };
  } catch (err) {
    if (err instanceof EgressError) return { reachable: false, error: "blocked: egress not allowed (link-local/metadata or policy)" };
    return { reachable: false, error: err instanceof Error ? err.message : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
