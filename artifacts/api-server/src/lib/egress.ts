/**
 * Egress / SSRF guard for the gateway's outbound HTTP.
 *
 * The headline this prevents is the Capital-One pattern: a server-side request
 * coerced to the cloud **metadata endpoint** (169.254.169.254 → IAM creds → data
 * lake). OmniProject legitimately calls *internal* hosts (n8n on the container
 * network, a self-hosted logging server), so a blanket private-range block would
 * break normal deployments. Instead:
 *
 *   - **Always blocked:** link-local / cloud-metadata targets (169.254.0.0/16,
 *     IPv6 fe80::/10 and fd00:ec2::254, IPv4-mapped IPv6 forms of the above, and
 *     the metadata.google.internal / metadata hostnames) — checked both against
 *     the URL's literal hostname AND, when it's a plain (non-IP) name, against
 *     every address it actually resolves to. The latter closes the classic
 *     SSRF-via-DNS bypass: an attacker-controlled domain that simply *resolves*
 *     to the metadata IP would sail past a hostname-string-only check. Nothing
 *     legitimate ever needs to reach these addresses through the app, so
 *     blocking them is free.
 *   - **Always blocked:** non-http(s) schemes (file:, gopher:, etc.).
 *   - **Optional strict mode:** set `EGRESS_ALLOWLIST` to a comma-separated host
 *     list and ALL outbound hosts must match — for deployments that want to pin
 *     egress to exactly their broker/IdP/FX hosts.
 *   - **Per-country residency:** when a `DATA_RESIDENCY_POLICY` is configured, the
 *     host must also sit in an allowed region's egress allowlist, else the hop is
 *     refused with a `DataResidencyError` (451). Inert when no policy is set.
 *
 * The range checks live in `lib/ip-ranges.ts` (byte/hextet-level containment, not
 * regex-against-the-raw-string), shared with `lib/url-safety.ts` so both guards
 * agree on exactly what "link-local/metadata" means.
 *
 * Use `safeFetch` everywhere the gateway makes an outbound request.
 */
import dns from "node:dns/promises";
import net from "node:net";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import { isBlockedHostLiteral, isBlockedIp, isPrivateOrLoopbackHostLiteral, isPrivateOrLoopbackIp } from "./ip-ranges";
import { parseCsvEnv, envFlag } from "./env";

// `data-residency` is loaded LAZILY (dynamic import in resolveAndValidate) rather than statically.
// egress is a very low-level guard that secret-at-rest modules (kms, vault-*) now route through, and
// data-residency transitively pulls in the audit chain / sealed-file — a static edge here closes a
// module-INIT cycle (sealed-file → config-crypto → kms → egress → data-residency → … → sealed-file)
// that throws a temporal-dead-zone error when the graph is entered via sealed-file. The residency
// check is per-request (already async) so a cached dynamic import costs nothing measurable.
type AssertEgressResidency = (rawUrl: string) => void;
let residencyFn: AssertEgressResidency | null = null;
async function assertEgressResidencyLazy(rawUrl: string): Promise<void> {
  residencyFn ??= (await import("./data-residency")).assertEgressResidency;
  residencyFn(rawUrl);
}

export class EgressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EgressError";
  }
}

export type LookupFn = (hostname: string, options: { all: true; verbatim: true }) => Promise<{ address: string; family: number }[]>;

/**
 * Validate a URL is allowed for server-side egress; throws EgressError if not.
 * Returns the parsed URL on success. ASYNC: a plain (non-IP-literal) hostname is
 * resolved via DNS and every returned address is checked too — a literal-hostname-
 * only check cannot catch a name that simply resolves to the metadata IP.
 *
 * Fails CLOSED on a DNS resolution error (can't confirm the target is safe ⇒
 * refuse) rather than falling through to the fetch, which would just hit the
 * same resolver moments later anyway.
 *
 * `lookup` is injectable (defaults to `dns.lookup`) purely so tests can supply a
 * deterministic resolver instead of depending on real network/DNS.
 */
type ResolvedAddr = { address: string; family: number };

/**
 * The shared validation body. Returns the parsed URL AND — when the host is a plain (non-literal-IP)
 * name — the exact set of addresses it resolved to and that we validated, so a caller can PIN the
 * connection to them (closing the DNS-rebinding TOCTOU where `fetch` re-resolves after the check).
 * `addresses` is null when the host is already an IP literal (nothing to pin / no rebinding window).
 */
async function resolveAndValidate(rawUrl: string, lookup: LookupFn): Promise<{ url: URL; addresses: ResolvedAddr[] | null }> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new EgressError("egress target is not a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new EgressError(`egress scheme "${u.protocol}" is not allowed (http/https only)`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase(); // strip IPv6 brackets
  if (isBlockedHostLiteral(host)) {
    throw new EgressError(`egress to ${host} is blocked (link-local/metadata range)`);
  }
  // A plain hostname (not already a literal IP) must also be checked by what it actually
  // resolves to — the DNS-rebinding-adjacent bypass this guard previously missed entirely.
  let addresses: ResolvedAddr[] | null = null;
  if (net.isIP(host) === 0) {
    try {
      addresses = await lookup(host, { all: true, verbatim: true });
    } catch (err) {
      throw new EgressError(`egress to ${host} could not be resolved: ${err instanceof Error ? err.message : String(err)}`);
    }
    const blocked = addresses.find((a) => isBlockedIp(a.address, a.family));
    if (blocked) {
      throw new EgressError(`egress to ${host} resolves to ${blocked.address}, which is blocked (link-local/metadata range)`);
    }
  }
  const allowlist = parseCsvEnv("EGRESS_ALLOWLIST");
  const allowSet = new Set(allowlist.map((s) => s.toLowerCase()));
  // OPT-IN hardened egress: also refuse RFC1918 / loopback / ULA / CGNAT targets (internal-network SSRF),
  // checked against BOTH the literal host and every resolved address (so a DNS name pointing at a private
  // IP can't slip through). An explicit EGRESS_ALLOWLIST entry is the escape hatch for a legitimate
  // internal host (e.g. the self-hosted broker). Off by default so existing internal-host deployments are
  // unaffected; the link-local/metadata floor above is enforced regardless of this flag.
  if (envFlag("EGRESS_BLOCK_PRIVATE") && !allowSet.has(host)) {
    if (isPrivateOrLoopbackHostLiteral(host)) {
      throw new EgressError(`egress to ${host} is blocked (private/loopback range; EGRESS_BLOCK_PRIVATE — allowlist it in EGRESS_ALLOWLIST if intended)`);
    }
    const priv = addresses?.find((a) => isPrivateOrLoopbackIp(a.address, a.family));
    if (priv) {
      throw new EgressError(`egress to ${host} resolves to ${priv.address}, which is blocked (private/loopback; EGRESS_BLOCK_PRIVATE)`);
    }
  }
  if (allowlist.length) {
    if (!allowSet.has(host)) {
      throw new EgressError(`egress to ${host} is not in EGRESS_ALLOWLIST`);
    }
  }
  // Per-country residency: when a JSON policy is active, the host must sit in an allowed region's
  // egress allowlist. Throws a fail-closed DataResidencyError (451); a no-op when no policy is set.
  await assertEgressResidencyLazy(rawUrl);
  return { url: u, addresses };
}

/** Validate a URL is allowed for server-side egress; throws EgressError if not. */
export async function assertEgressAllowed(rawUrl: string, lookup?: LookupFn): Promise<URL> {
  return (await resolveAndValidate(rawUrl, effectiveLookup(lookup))).url;
}

/** A dns.lookup-shaped function that ALWAYS returns the pre-validated addresses, ignoring the real
 *  resolver — handed to undici's connector so the socket connects only to the IPs we checked, not
 *  whatever the hostname re-resolves to at connect time. Handles undici/net's `all` + single forms. */
type LookupCallback = (err: Error | null, address: string | ResolvedAddr[], family?: number) => void;
function pinnedLookup(addresses: ResolvedAddr[]) {
  return (_hostname: string, options: unknown, callback?: LookupCallback): void => {
    const cb = (typeof options === "function" ? options : callback) as LookupCallback;
    const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all;
    if (all) cb(null, addresses.map((a) => ({ address: a.address, family: a.family })));
    else cb(null, addresses[0]!.address, addresses[0]!.family);
  };
}

/**
 * A `dns.lookup`-shaped resolver that VALIDATES every address before returning it, refusing (via an
 * error callback) any link-local/metadata target so the socket never connects to one. Unlike
 * `pinnedLookup` (which replays already-validated addresses for a single safeFetch call), this
 * resolves and checks AT CONNECT TIME — so it can guard a PERSISTENT dispatcher (e.g. the broker
 * keep-alive Agent) without a per-call dispatcher, closing the DNS-rebinding TOCTOU while keeping the
 * pooled connection + mTLS. It enforces only the link-local/metadata floor (not the host allowlist /
 * residency, which the caller's `assertEgressAllowed` still applies against the fixed URL host).
 */
export function guardedLookup(hostname: string, options: unknown, callback?: LookupCallback): void {
  const cb = (typeof options === "function" ? options : callback) as LookupCallback;
  const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all === true;
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const deliver = (addrs: ResolvedAddr[]): void => {
    const blocked = addrs.find((a) => isBlockedIp(a.address, a.family));
    if (blocked) { cb(new EgressError(`egress to ${host} resolves to ${blocked.address}, which is blocked (link-local/metadata range)`), []); return; }
    if (all) cb(null, addrs.map((a) => ({ address: a.address, family: a.family })));
    else cb(null, addrs[0]!.address, addrs[0]!.family);
  };
  const lit = net.isIP(host);
  if (lit !== 0) { deliver([{ address: host, family: lit }]); return; }
  if (isBlockedHostLiteral(host)) { cb(new EgressError(`egress to ${host} is blocked (link-local/metadata host)`), []); return; }
  dns.lookup(host, { all: true, verbatim: true })
    .then((addrs) => deliver(addrs as ResolvedAddr[]))
    .catch((err) => cb(new EgressError(`egress to ${host} could not be resolved: ${err instanceof Error ? err.message : String(err)}`), []));
}

/** TEST-ONLY seam: safeFetch uses undici's own fetch (a custom Agent isn't accepted by global fetch),
 *  so a test that stubs `globalThis.fetch` wouldn't intercept it. Tests set this to their mock instead
 *  (it still runs AFTER the egress validation, so the guard is exercised). Null = real transport. */
let egressTransportForTest: typeof fetch | null = null;
/** Install (or clear, with null) the TEST-ONLY transport seam used by safeFetch. */
export function __setEgressTransportForTest(fn: typeof fetch | null): void { egressTransportForTest = fn; }

/** TEST-ONLY seam: a deterministic resolver so a unit test can exercise safeFetch/assertEgressAllowed
 *  without real DNS (the guard still runs against these addresses). Pair it with the transport seam
 *  above when the code under test calls safeFetch/assertEgressAllowed with no injectable lookup of its
 *  own (e.g. the vault/KMS stores). Null = use the real dns.lookup. */
let egressLookupForTest: LookupFn | null = null;
/** Install (or clear, with null) the TEST-ONLY resolver seam used by safeFetch/assertEgressAllowed. */
export function __setEgressLookupForTest(fn: LookupFn | null): void { egressLookupForTest = fn; }

/** Resolve the effective lookup: an explicit per-call arg wins, else the test seam, else real DNS. */
function effectiveLookup(explicit: LookupFn | undefined): LookupFn {
  return explicit ?? egressLookupForTest ?? dns.lookup;
}

/** Max redirects safeFetch will follow before refusing — matches the WHATWG fetch limit of 20. */
const MAX_EGRESS_REDIRECTS = 20;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Issue ONE validated hop (no automatic redirect following). `addresses` pins the connection to the
 *  vetted IPs for a hostname target; an IP-literal target needs no dispatcher. Redirects are forced to
 *  "manual" so safeFetch itself decides whether to follow — re-validating each Location first. */
function dispatchOne(url: string, init: UndiciRequestInit | undefined, addresses: ResolvedAddr[] | null): Promise<Response> {
  const withManual = { ...(init ?? {}), redirect: "manual" as const };
  if (egressTransportForTest) return egressTransportForTest(url, withManual as unknown as RequestInit);
  if (!addresses || addresses.length === 0) {
    return undiciFetch(url, withManual) as unknown as Promise<Response>;
  }
  // Pin the vetted IPs into a per-call dispatcher. Not explicitly closed: its idle sockets close on
  // the keep-alive timeout and it is then GC'd (the response body stream keeps the socket alive until
  // the caller consumes it, so closing here would abort the body).
  const dispatcher = new Agent({ connect: { lookup: pinnedLookup(addresses) }, keepAliveTimeout: 1_000, keepAliveMaxTimeout: 1_000 });
  return undiciFetch(url, { ...withManual, dispatcher }) as unknown as Promise<Response>;
}

/** Adjust method/body when following a redirect, per the fetch spec: 303 (and 301/302 from POST)
 *  become a bodyless GET; 307/308 preserve method + body. */
function initForRedirect(init: UndiciRequestInit | undefined, status: number): UndiciRequestInit | undefined {
  const method = (init?.method ?? "GET").toUpperCase();
  const toGet = status === 303 || ((status === 301 || status === 302) && method !== "GET" && method !== "HEAD");
  if (!toGet) return init;
  const next = { ...(init ?? {}), method: "GET" };
  delete (next as { body?: unknown }).body;
  return next;
}

/**
 * fetch() with the egress guard applied first — throws EgressError before any network call when the
 * target is disallowed. For a hostname target it also PINS the connection to the exact addresses it
 * validated (via a dedicated undici dispatcher), so the hostname cannot be re-resolved to a
 * link-local/metadata IP between the check and the connect (DNS-rebinding TOCTOU).
 *
 * REDIRECTS ARE FOLLOWED MANUALLY, re-running the FULL egress guard on every hop. undici's built-in
 * redirect following would connect to the `Location` target WITHOUT re-validation — so a benign
 * allowed host could 302 the gateway straight to `http://169.254.169.254/…` (an IP literal, which the
 * original host's pinned dispatcher does not constrain) and reach the metadata endpoint. Re-validating
 * each hop closes that SSRF-redirect bypass. `lookup` is injectable purely for tests. Uses undici's own
 * fetch (a custom Agent isn't accepted by global fetch).
 */
export async function safeFetch(url: string, init?: RequestInit, lookup?: LookupFn): Promise<Response> {
  const lk = effectiveLookup(lookup);
  let currentUrl = url;
  let currentInit = init as UndiciRequestInit | undefined;
  for (let hop = 0; ; hop++) {
    const { addresses } = await resolveAndValidate(currentUrl, lk);
    const resp = await dispatchOne(currentUrl, currentInit, addresses);
    const location = resp.headers.get("location");
    if (!REDIRECT_STATUSES.has(resp.status) || !location) return resp;
    if (hop >= MAX_EGRESS_REDIRECTS) {
      throw new EgressError(`egress exceeded ${MAX_EGRESS_REDIRECTS} redirects (possible redirect loop)`);
    }
    // Resolve the Location relative to the current URL, then loop — the next iteration re-validates it
    // through the same guard (scheme, link-local/metadata literal AND resolved IPs, allowlist, residency).
    let nextUrl: string;
    try {
      nextUrl = new URL(location, currentUrl).toString();
    } catch {
      throw new EgressError(`egress redirect Location is not a valid URL: ${location}`);
    }
    void resp.body?.cancel?.().catch(() => {}); // free the socket; we won't read this hop's body
    currentInit = initForRedirect(currentInit, resp.status);
    currentUrl = nextUrl;
  }
}
