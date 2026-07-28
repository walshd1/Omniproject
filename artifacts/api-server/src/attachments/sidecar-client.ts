/**
 * The gateway's no-SDK bridge to the attachments-broker service. The gateway holds only the pointer
 * record; the BYTES live in the sidecar (a separate process, `services/attachments-broker`). This keeps
 * the gateway zero-at-rest and object-store-SDK-free (the `guard-zero-at-rest-above-seam` guard stays
 * green) — the process boundary, not just a package boundary, keeps the bytes below the seam.
 *
 * Off-by-default: when `ATTACHMENTS_SIDECAR_URL` is unset there is no client, and the attachments routes
 * answer the honest "not configured" — exactly the shape the retention broker uses.
 */
import { safeFetch } from "../lib/egress";

export interface AttachmentsSidecar {
  /** Store bytes under `key`; the sidecar returns the size + content fingerprint it computed. */
  putBlob(key: string, bytes: Buffer, contentType?: string): Promise<{ size: number; sha256: string }>;
  /** Fetch bytes for `key`, or null if the sidecar has none. */
  getBlob(key: string): Promise<Buffer | null>;
  /** Remove bytes for `key` (idempotent — a missing blob is not an error). */
  delBlob(key: string): Promise<void>;
  /** Liveness probe. */
  health(): Promise<boolean>;
}

export interface AttachmentsSidecarOptions {
  /** Base URL of the attachments-broker (e.g. http://attachments-broker:8091). */
  baseUrl: string;
  /** Optional bearer token; sent as `Authorization: Bearer <token>` when set. */
  token?: string;
  /** Injectable fetch (defaults to the egress-guarded safeFetch) — tests pass a fake. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms (default 30s — uploads can be larger than a JSON call). */
  timeoutMs?: number;
}

/** Build a client over a base URL + optional token. Defaults to `safeFetch` so every hop honours the
 *  egress/SSRF/residency guard, exactly like the retention-broker client. */
export function makeAttachmentsClient(opts: AttachmentsSidecarOptions): AttachmentsSidecar {
  const base = opts.baseUrl.replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? safeFetch;
  const authHeader = opts.token ? { authorization: `Bearer ${opts.token}` } : {};

  async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
    try {
      return await run(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    putBlob: (key, bytes, contentType) =>
      withTimeout(async (signal) => {
        const res = await doFetch(`${base}/blob/${encodeURIComponent(key)}`, {
          method: "PUT",
          headers: { "content-type": contentType || "application/octet-stream", ...authHeader },
          body: bytes,
          signal,
        });
        if (!res.ok) throw new Error(`attachments-broker put failed: ${res.status}`);
        return (await res.json()) as { size: number; sha256: string };
      }),
    getBlob: (key) =>
      withTimeout(async (signal) => {
        const res = await doFetch(`${base}/blob/${encodeURIComponent(key)}`, { headers: { ...authHeader }, signal });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`attachments-broker get failed: ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
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
  };
}

let current: AttachmentsSidecar | null = null;

/**
 * Register the attachments sidecar from the environment. When `ATTACHMENTS_SIDECAR_URL` is set, the
 * attachments feature has a byte store; a no-op (and clears any prior client) when unset. Call once at
 * boot. Returns true iff a client was registered.
 */
export function registerAttachmentsFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const baseUrl = env["ATTACHMENTS_SIDECAR_URL"]?.trim();
  if (!baseUrl) {
    current = null;
    return false;
  }
  const token = env["ATTACHMENTS_SIDECAR_TOKEN"]?.trim();
  current = makeAttachmentsClient({ baseUrl, ...(token ? { token } : {}) });
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
