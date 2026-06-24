import crypto from "node:crypto";
import type { Request } from "express";
import { getSession } from "../routes/auth";
import { roleForReq } from "./rbac";
import { getSettings } from "./settings";
import { recordAudit } from "./audit";

/** The gateway is the origin of UI-initiated changes. */
export const GATEWAY_ORIGIN = "omniproject";

/**
 * Secure context block carried in the outbound payload so n8n can perform
 * downstream writes *as the active user* (dynamic Bearer override) instead of a
 * shared admin token — preserving per-user auditing in Plane/OpenProject.
 */
export interface UserContext {
  sub?: string;
  email?: string;
  name?: string;
  role?: string;
  token?: string;
}

/** Build the user-context block from the request's session. */
export function userContextFromReq(req: Request): UserContext {
  const session = getSession(req);
  if (!session) return {};
  return { sub: session.sub, email: session.email, name: session.name, role: roleForReq(req), token: session.accessToken };
}

/**
 * Deterministic idempotency key:
 *   sha256(action + projectId + issueId + timestamp_rounded_to_nearest_minute)
 * Identical actions on the same entity within the same minute collapse to the
 * same key, letting n8n drop duplicate triggers / webhook storms and resolve
 * simultaneous cross-system edit races.
 */
export function idempotencyKey(action: string, payload: Record<string, unknown>): string {
  const projectId = String(payload["projectId"] ?? "");
  const issueId = String(payload["issueId"] ?? "");
  const minute = Math.round(Date.now() / 60_000);
  return crypto.createHash("sha256").update(`${action}:${projectId}:${issueId}:${minute}`).digest("hex");
}

/**
 * Single broker to n8n. Every project/issue data action and every mutating
 * user action flows through here, so n8n is the sole integration point with the
 * headless backends (Plane, OpenProject, or anything else wired into n8n).
 *
 * n8n is considered "configured" when N8N_WEBHOOK_URL is set in the environment.
 * When it isn't, the gateway runs in demo mode and serves sample data instead —
 * the same env-gated pattern used for OIDC.
 */

const ENV_WEBHOOK = process.env["N8N_WEBHOOK_URL"]?.trim();

export const isN8nConfigured = !!ENV_WEBHOOK;

export interface N8nResult<T = unknown> {
  success: boolean;
  data?: T;
  message?: string | null;
}

export class N8nError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "N8nError";
    this.status = status;
  }
}

function webhookUrl(): string {
  // Settings may override the env default at runtime.
  return getSettings().n8nWebhookUrl || ENV_WEBHOOK || "http://localhost:5678/webhook/omniproject";
}

/** Derive the bearer token to forward: explicit header first, then the session. */
export function authHeaderFromReq(req: Request): string | undefined {
  const explicit = req.headers["authorization"];
  if (explicit) return Array.isArray(explicit) ? explicit[0] : explicit;
  const session = getSession(req);
  return session?.accessToken ? `Bearer ${session.accessToken}` : undefined;
}

/**
 * Forward an action to n8n and return its normalized result. n8n is expected to
 * respond with an N8nActionResult ({ success, data, message }); bare payloads
 * are wrapped so callers always see that shape.
 */
export async function callN8n<T = unknown>(
  action: string,
  payload: Record<string, unknown>,
  opts: { authHeader?: string; source?: string; userContext?: UserContext; origin?: string } = {},
): Promise<N8nResult<T>> {
  const origin = opts.origin ?? GATEWAY_ORIGIN;
  const key = idempotencyKey(action, payload);

  // Enrich the payload with the loop-guard origin and the user-context block
  // (downstream nodes read userContext.token for per-user impersonation).
  const enrichedPayload: Record<string, unknown> = {
    ...payload,
    origin,
    ...(opts.userContext ? { userContext: opts.userContext } : {}),
  };

  // Enterprise audit trail: one structured event per proxied operation, recorded
  // *with its outcome* (success/failure + upstream status + latency) so logs can
  // answer "who ran which n8n action, when, and did it succeed?". Emitted to
  // stdout and (when configured) shipped to the external logging server; OIDC
  // tokens / cookies are redacted by the pino config.
  const startedAt = Date.now();
  const audit = (result: "success" | "error", status: number, extra?: Record<string, unknown>) =>
    recordAudit({
      ts: new Date().toISOString(),
      category: "broker",
      action,
      actor: opts.userContext ? { sub: opts.userContext.sub, email: opts.userContext.email, role: opts.userContext.role } : null,
      projectId: (payload["projectId"] as string | undefined) ?? null,
      origin,
      write: /^(create|update|delete)_/.test(action),
      result,
      status,
      ms: Date.now() - startedAt,
      meta: { idempotencyKey: key, source: opts.source, ...extra },
    });

  try {
    const res = await fetch(webhookUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(opts.authHeader ? { Authorization: opts.authHeader } : {}),
        "X-OmniProject-Source": opts.source ?? "unknown",
        "X-OmniProject-Action": action,
        "X-OmniProject-Origin": origin,
        "X-OmniProject-Idempotency-Key": key,
      },
      body: JSON.stringify({ action, payload: enrichedPayload, source: opts.source, origin, idempotencyKey: key }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      // Propagate the upstream status so meaningful codes survive — notably 409
      // (optimistic-concurrency conflict from the backend) and 404. Anything in
      // the 5xx range collapses to a 502 gateway error.
      const detail = await res.text().catch(() => "");
      const status = res.status >= 400 && res.status < 500 ? res.status : 502;
      throw new N8nError(detail?.slice(0, 300) || `n8n returned ${res.status}`, status);
    }

    const json = (await res.json().catch(() => ({}))) as unknown;
    const result: N8nResult<T> =
      json && typeof json === "object" && "success" in json ? (json as N8nResult<T>) : { success: true, data: json as T };
    audit(result.success === false ? "error" : "success", res.status, result.success === false ? { message: result.message } : undefined);
    return result;
  } catch (err) {
    const status = err instanceof N8nError ? err.status : 0;
    audit("error", status, { error: err instanceof Error ? err.name : "error" });
    throw err;
  }
}
