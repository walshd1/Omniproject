import type { Request } from "express";
import { getSession } from "../routes/auth";
import { getSettings } from "./settings";

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
  opts: { authHeader?: string; source?: string } = {},
): Promise<N8nResult<T>> {
  const res = await fetch(webhookUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(opts.authHeader ? { Authorization: opts.authHeader } : {}),
      "X-OmniProject-Source": opts.source ?? "unknown",
      "X-OmniProject-Action": action,
    },
    body: JSON.stringify({ action, payload, source: opts.source }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new N8nError(`n8n returned ${res.status}`);
  }

  const json = (await res.json().catch(() => ({}))) as unknown;
  if (json && typeof json === "object" && "success" in json) {
    return json as N8nResult<T>;
  }
  return { success: true, data: json as T };
}
