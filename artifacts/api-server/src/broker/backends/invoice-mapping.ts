/**
 * Generic invoice-sync PROJECTOR — the backend-vendor-NEUTRAL engine that maps OmniProject's agnostic invoice
 * surface onto whatever a backend ADVERTISES, and back, driven entirely by an {@link InvoiceSyncSpec} the
 * backend carries in its catalogue manifest. There is no vendor name or vendor-shaped branch in this file: it
 * reads the advertised field map + a small fixed set of named transform primitives and applies them.
 *
 * This is the "backend advertises its fields through the broker, mapped to an agnostic surface" model taken all
 * the way — the same way the ordinary contract verbs are already executed from the manifest's `actions`. Outbound
 * it projects the agnostic Invoice to the vendor payload the broker will POST; inbound it normalises the vendor's
 * response / settlement webhook back to the agnostic external ref + paid signal + `{ invoiceId, amount }`.
 *
 * The transform set is deliberately CLOSED (no server-side evaluation of vendor-supplied expressions): every
 * non-rename mapping is a named primitive below. A backend needing a transform outside the set adds a primitive
 * here (a reviewed code change) rather than shipping arbitrary logic as data.
 */

import type {
  InvoiceSyncSpec, InvoiceSyncOutboundField as OutboundField, InvoiceSyncPredicate as Predicate,
} from "@workspace/backend-catalogue";
import { asRecord as asRec, getPath, unwrap, applyTransform, evalPredicate } from "../projection";

/** Re-export the advertised-spec types (authored in the backend manifest, see backend-manifest.ts) for
 *  callers/tests of the projector. */
export type { InvoiceSyncSpec, OutboundField, Predicate };

/** OmniProject's own correlation namespace stamped on the vendor record so an inbound webhook maps back to the
 *  local invoice. Ours, not the vendor's — the vendor only advertises WHICH field carries it. */
const CORRELATION_PREFIX = "omni:";

/** The normalised external ref stored back on the local invoice (backend-neutral; `system` is the backend id). */
export interface ExternalRefShape {
  system: string;
  id: string;
  number: string | null;
  pdfUrl: string | null;
  pushedAt: string;
}

// ── Correlation (OmniProject's namespace) ────────────────────────────────────────────────────────────────

export function correlationValue(invoiceId: string): string {
  return `${CORRELATION_PREFIX}${invoiceId}`;
}
export function parseCorrelation(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(CORRELATION_PREFIX)) return null;
  const id = value.slice(CORRELATION_PREFIX.length);
  return id.length > 0 ? id : null;
}

// ── Outbound projection (agnostic Invoice → advertised vendor payload) ───────────────────────────────────

/** Project the agnostic invoice to the vendor payload the broker will send, applying the advertised field map
 *  + transforms via the shared projection engine. `invoice` is a loose record so this file needs no coupling to
 *  the Invoice type. Pure. */
export function projectOutbound(invoice: Record<string, unknown>, spec: InvoiceSyncSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of spec.outbound.fields) out[f.to] = applyTransform(invoice, f);
  const lines = Array.isArray(invoice[spec.outbound.lines.from]) ? (invoice[spec.outbound.lines.from] as unknown[]) : [];
  out[spec.outbound.lines.to] = lines.map((ln) => {
    const rec = asRec(ln) ?? {};
    const mapped: Record<string, unknown> = {};
    for (const f of spec.outbound.lines.fields) mapped[f.to] = applyTransform(rec, f);
    return mapped;
  });
  out[spec.outbound.correlationTo] = correlationValue(String(invoice["id"]));
  return out;
}

// ── Inbound normalisation (vendor response → agnostic ref / paid) ─────────────────────────────────────────

/** Normalise a create/update response into the external ref, or null when no usable id is present. */
export function parseExternalRef(raw: unknown, spec: InvoiceSyncSpec, system: string, now: string): ExternalRefShape | null {
  const data = unwrap(raw, spec.inbound.unwrap);
  if (!data) return null;
  const rawId = getPath(data, spec.inbound.id);
  const id = typeof rawId === "string" ? rawId : typeof rawId === "number" ? String(rawId) : null;
  if (!id) return null;
  const number = spec.inbound.number ? getPath(data, spec.inbound.number) : null;
  const pdf = spec.inbound.pdf ? getPath(data, spec.inbound.pdf) : null;
  return {
    system,
    id,
    number: typeof number === "string" ? number : null,
    pdfUrl: typeof pdf === "string" ? pdf : null,
    pushedAt: now,
  };
}

/** Read the settlement signal ("paid" | null) from a vendor invoice record via the advertised predicate. */
export function parsePaid(raw: unknown, spec: InvoiceSyncSpec): "paid" | null {
  const data = unwrap(raw, spec.inbound.unwrap);
  if (!data) return null;
  return evalPredicate(data, spec.inbound.paid) ? "paid" : null;
}

/** Resolve the local invoice id + optional settlement amount from an inbound webhook, or null when not ours. */
export function parseWebhook(raw: unknown, spec: InvoiceSyncSpec): { invoiceId: string; amount: number | null } | null {
  const obj = asRec(raw);
  if (!obj) return null;
  const w = spec.webhook;
  const corrFields = [w && spec.correlation.field, ...(spec.correlation.altFields ?? [])].filter(Boolean) as string[];

  const amount = (): number | null => {
    for (const wrap of [obj, ...(w.amountWrappers ?? []).map((k) => asRec(obj[k]))]) {
      const a = Number(wrap?.[w.amountField]);
      if (Number.isFinite(a) && a > 0) return a;
    }
    return null;
  };

  const candidates: Array<Record<string, unknown> | null> = [obj, ...(w.wrappers ?? []).map((k) => asRec(obj[k]))];
  for (const wrap of [obj, ...(w.arrayWrappers ?? []).map((k) => asRec(obj[k]))]) {
    const arr = w.invoicesKey ? wrap?.[w.invoicesKey] : undefined;
    if (Array.isArray(arr)) for (const el of arr) candidates.push(asRec(el));
  }
  for (const c of candidates) {
    if (!c) continue;
    let rawCorr: unknown;
    for (const field of corrFields) { if (c[field] != null) { rawCorr = c[field]; break; } }
    const id = parseCorrelation(rawCorr);
    if (id) return { invoiceId: id, amount: amount() };
  }
  return null;
}

// ── Deploy-config helpers (env names advertised as data, resolved generically) ───────────────────────────

/** True when any of the advertised enable-env vars is truthy (`1`/`true`/`on`). */
export function syncEnabled(spec: InvoiceSyncSpec, env: NodeJS.ProcessEnv): boolean {
  return spec.env.enable.some((name) => {
    const v = (env[name] ?? "").trim().toLowerCase();
    return v === "1" || v === "true" || v === "on";
  });
}

/** The first non-blank advertised webhook-secret env var, or undefined ⇒ webhook disabled. */
export function webhookSecret(spec: InvoiceSyncSpec, env: NodeJS.ProcessEnv): string | undefined {
  for (const name of spec.env.webhookSecret) {
    const s = env[name]?.trim();
    if (s) return s;
  }
  return undefined;
}
