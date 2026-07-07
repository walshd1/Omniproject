/**
 * Shared in-process HTTP test harness for api-server route integration tests.
 *
 * Boots the REAL Express app on an ephemeral port and mints signed `omni_session`
 * cookies so route guards (RBAC + step-up) can be exercised end-to-end. Lives under
 * __tests__/ (which .c8rc.json excludes from coverage) so this helper never dilutes
 * the numbers — only the src/routes + src/lib code it drives is measured.
 *
 * Env MUST be set before ./app is imported (app reads SESSION_SECRET etc. at module
 * load), so these assignments run at import time and callers import this module first.
 */
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

export const TEST_SECRET = "integration-harness-secret";

// Only seed if a test file hasn't already chosen its own values.
process.env["SESSION_SECRET"] ??= TEST_SECRET;
process.env["NODE_ENV"] ??= "production";
process.env["RATE_LIMIT_DISABLED"] ??= "true";
// Harness convenience: demo auth + rate-limiting-off would otherwise be boot-refusing
// CRITICAL findings under the default strict posture. This is a test process, not a deploy.
process.env["SECURITY_STRICT"] ??= "off";

/** Sign a session object into the `omni_session=s:<json>.<hmac>` cookie the app expects. */
export function cookie(session: object, secret = process.env["SESSION_SECRET"] ?? TEST_SECRET): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", secret).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}

const BASE_SESSION = { sub: "u-harness", name: "Grace Hopper", email: "grace@x.io" };

/** A signed-in admin (all coarse RBAC roles). */
export function adminCookie(extra: Record<string, unknown> = {}): string {
  return cookie({ ...BASE_SESSION, roles: ["omni-admins"], ...extra });
}

/** An admin whose session carries a fresh step-up (satisfies requireStepUp). */
export function stepUpAdminCookie(extra: Record<string, unknown> = {}): string {
  return adminCookie({ stepUpAt: Date.now(), ...extra });
}

/** A signed-in non-admin member (for RBAC 403 paths). */
export function memberCookie(extra: Record<string, unknown> = {}): string {
  return cookie({ ...BASE_SESSION, roles: ["omni-members"], ...extra });
}

export interface Harness {
  server: Server;
  base: string;
  /** fetch against `${base}/api${path}` with the given cookie + JSON body. */
  req: (
    path: string,
    opts?: { method?: string; cookie?: string; body?: unknown; headers?: Record<string, string> },
  ) => Promise<Response>;
  close: () => void;
}

/** Boot the app and return a harness bound to its base URL. Call in a node:test `before`. */
export async function startHarness(): Promise<Harness> {
  const { default: app } = await import("../app");
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const req: Harness["req"] = (path, opts = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.cookie) headers["cookie"] = opts.cookie;
    if (opts.body !== undefined) headers["content-type"] ??= "application/json";
    const init: RequestInit = { method: opts.method ?? "GET", headers };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    return fetch(`${base}/api${path}`, init);
  };
  return { server, base, req, close: () => server.close() };
}
