import type { Response } from "express";

/**
 * The one home for the northbound JSON error envelope. Routes across the gateway hand-shaped
 * `res.status(n).json({ error: "…" })` inline; this centralises that single wire contract so the
 * error body can be changed (a request id, a machine-readable `code`) in ONE place, and every plain
 * error reads the same way.
 *
 * Deliberately MINIMAL (design principle #17 — keep it tiny, don't switch-on-shape): it emits
 * `{ error, …extra }`. The richer, shape-specific responses stay with their own owners — the
 * validation `{ error, issues }` belongs to `parseOr400`/`zodParseOr400`, the settings-collection
 * `{ error, pending }` to its router — because those carry a different, purpose-specific contract.
 */
export function sendError(res: Response, status: number, message: string, extra?: Record<string, unknown>): void {
  res.status(status).json({ error: message, ...(extra ?? {}) });
}
