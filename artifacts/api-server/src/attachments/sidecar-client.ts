/**
 * The gateway's no-SDK bridge to the attachments-broker service. The gateway NEVER handles a file's bytes:
 * it holds only the pointer record and mints short-lived, HMAC-signed TICKETS that let the browser upload
 * and download bytes DIRECTLY to/from the sidecar's `/portal/*` endpoints. The bytes therefore live only in
 * the sidecar (a separate, hardened process, `services/attachments-broker`) — a (possibly malicious) upload
 * is never anywhere but that isolated container. This also keeps the gateway zero-at-rest and
 * object-store-SDK-free (the `guard-zero-at-rest-above-seam` guard stays green).
 *
 * Two planes, mirroring the sidecar:
 *  - the browser plane is reached by the browser directly, via a ticket URL this module mints
 *    (`mintPortalUrl`) — the gateway only produces the URL, it never proxies the bytes;
 *  - the server plane (`/blob/<key>`) is bearer-token, server-to-server, used here only for metadata ops:
 *    `headBlob` (verify a browser upload landed + its size) and `delBlob` (drop bytes on removal).
 *
 * Off-by-default: when `ATTACHMENTS_SIDECAR_URL` is unset there is no client, and the attachments routes
 * answer the honest "not configured" — exactly the shape the retention broker uses.
 */
import { createHmac } from "node:crypto";
import { safeFetch } from "../lib/egress";

/** Ticket lifetime — long enough for a browser upload/download to start, short enough to bound replay. */
const TICKET_TTL_MS = 5 * 60 * 1000;

const b64url = (buf: Buffer | string): string => Buffer.from(buf).toString("base64url");

/** Sign a ticket payload with the shared secret — the exact mirror of the sidecar's `signTicket`. The
 *  sidecar verifies it (op + key + expiry) before serving the browser's direct byte transfer. */
function signTicket(payload: Record<string, unknown>, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${mac}`;
}

export interface AttachmentsSidecar {
  /** Existence + size over the server plane — used to verify a browser upload actually landed. null if absent. */
  headBlob(key: string): Promise<{ size: number } | null>;
  /** Remove bytes for `key` (idempotent — a missing blob is not an error). */
  delBlob(key: string): Promise<void>;
  /** Liveness probe. */
  health(): Promise<boolean>;
  /** True iff the browser byte-path is fully wired (a browser-reachable public URL + a ticket secret). */
  canMintTickets(): boolean;
  /** Mint a browser-facing portal URL (+ expiry) scoped to one op on one key. The browser sends bytes
   *  straight to this URL; the gateway never sees them. Throws when `canMintTickets()` is false. */
  mintPortalUrl(op: "put" | "get", key: string, opts?: { room?: string; name?: string }): { url: string; expiresAt: number };
}

export interface AttachmentsSidecarOptions {
  /** Internal base URL of the attachments-broker server plane (e.g. http://attachments-broker:8091). */
  baseUrl: string;
  /** Browser-reachable base URL of the sidecar's portal ingress (e.g. https://attachments.example.com). */
  publicUrl?: string;
  /** Shared HMAC secret for minting portal tickets the sidecar verifies. Without it the byte-path is off. */
  ticketSecret?: string;
  /** Optional bearer token; sent as `Authorization: Bearer <token>` on server-plane calls when set. */
  token?: string;
  /** Injectable fetch (defaults to the egress-guarded safeFetch) — tests pass a fake. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms for the (small, JSON/metadata-only) server-plane calls. */
  timeoutMs?: number;
  /** Injectable clock (ms) for deterministic ticket-expiry tests. */
  now?: () => number;
}

/** Build a client over a base URL + optional token/public-url/ticket-secret. Server-plane calls default to
 *  `safeFetch` so every hop honours the egress/SSRF/residency guard, exactly like the retention-broker client. */
export function makeAttachmentsClient(opts: AttachmentsSidecarOptions): AttachmentsSidecar {
  const base = opts.baseUrl.replace(/\/$/, "");
  const publicBase = opts.publicUrl?.replace(/\/$/, "");
  const ticketSecret = opts.ticketSecret;
  const doFetch = opts.fetchImpl ?? safeFetch;
  const authHeader = opts.token ? { authorization: `Bearer ${opts.token}` } : {};
  const now = opts.now ?? Date.now;

  async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
    try {
      return await run(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    headBlob: (key) =>
      withTimeout(async (signal) => {
        const res = await doFetch(`${base}/blob/${encodeURIComponent(key)}`, { method: "HEAD", headers: { ...authHeader }, signal });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`attachments-broker head failed: ${res.status}`);
        const size = Number(res.headers.get("x-attachment-size"));
        return { size: Number.isFinite(size) ? size : 0 };
      }),
    delBlob: (key) =>
      withTimeout(async (signal) => {
        const res = await doFetch(`${base}/blob/${encodeURIComponent(key)}`, { method: "DELETE", headers: { ...authHeader }, signal });
        if (!res.ok && res.status !== 404) throw new Error(`attachments-broker delete failed: ${res.status}`);
      }),
    health: () =>
      withTimeout(async (signal) => {
        try {
          const res = await doFetch(`${base}/healthz`, { signal });
          return res.ok;
        } catch {
          return false;
        }
      }),
    canMintTickets: () => !!(publicBase && ticketSecret),
    mintPortalUrl: (op, key, ticketOpts) => {
      if (!publicBase || !ticketSecret) throw new Error("attachments byte-path not configured (need public URL + ticket secret)");
      const exp = now() + TICKET_TTL_MS;
      const payload: Record<string, unknown> = { op, key, exp };
      if (ticketOpts?.room) payload["room"] = ticketOpts.room;
      if (op === "get" && ticketOpts?.name) payload["name"] = ticketOpts.name;
      const ticket = signTicket(payload, ticketSecret);
      return { url: `${publicBase}/portal/${encodeURIComponent(key)}?ticket=${ticket}`, expiresAt: exp };
    },
  };
}

let current: AttachmentsSidecar | null = null;

/**
 * Register the attachments sidecar from the environment. When `ATTACHMENTS_SIDECAR_URL` is set, the
 * attachments feature has a byte store; a no-op (and clears any prior client) when unset. The browser
 * byte-path additionally needs `ATTACHMENTS_SIDECAR_PUBLIC_URL` + `ATTACHMENTS_TICKET_SECRET` — without
 * them uploads/downloads report "not configured" while pointer listing/delete still work. Call once at
 * boot. Returns true iff a client was registered.
 */
export function registerAttachmentsFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const baseUrl = env["ATTACHMENTS_SIDECAR_URL"]?.trim();
  if (!baseUrl) {
    current = null;
    return false;
  }
  const token = env["ATTACHMENTS_SIDECAR_TOKEN"]?.trim();
  const publicUrl = env["ATTACHMENTS_SIDECAR_PUBLIC_URL"]?.trim();
  const ticketSecret = env["ATTACHMENTS_TICKET_SECRET"]?.trim();
  current = makeAttachmentsClient({
    baseUrl,
    ...(token ? { token } : {}),
    ...(publicUrl ? { publicUrl } : {}),
    ...(ticketSecret ? { ticketSecret } : {}),
  });
  return true;
}

/** The registered sidecar client, or null when attachments aren't configured. */
export function attachmentsSidecar(): AttachmentsSidecar | null {
  return current;
}

/** Test-only: set the active client directly (bypasses env). */
export function _setAttachmentsSidecarForTest(client: AttachmentsSidecar | null): void {
  current = client;
}
