/**
 * Backend billing-adapter SEAM — the neutral boundary between the gateway's invoice routes and a concrete
 * backend's outbound billing sync (push / pull-back / inbound settlement webhook).
 *
 * This mirrors the broker seam (`broker/index.ts`) on the *backend* axis. Above this line the product is
 * backend-vendor-NEUTRAL: the invoice routes and the webhook router talk to a backend only through the
 * generic {@link BillingAdapter} interface and resolve the active adapter from the connected `backendSource`
 * — they never name a vendor, never import a concrete adapter, and never branch on a vendor id literal. The
 * one place a backend vendor's push/pull/webhook code is named is its adapter file in this folder
 * (`broker/backends/<vendor>.ts`), the sanctioned home the backend-isolation guard allowlists. Adding a
 * second billing backend is a new adapter file + a registry line here — zero route changes.
 *
 * Only invoice sync needs a gateway-side adapter at all: the ordinary contract verbs (create/get/list_*) are
 * already executed backend-agnostically through the broker + generated workflow. Sync is the exception
 * because it reconciles an EXTERNAL settlement back onto a LOCAL sealed invoice artifact, which is
 * gateway-owned — so the neutral glue (store the ref, advance status) lives above the seam and only the
 * vendor-shaped mapping lives in the adapter.
 */
import type { ActorContext } from "../types";
import type { Invoice, InvoiceExternalRef } from "../../lib/invoice";
import { getSettings } from "../../lib/settings";
import { invoiceNinjaBillingAdapter } from "./invoice-ninja";

/** The neutral capability surface a backend exposes for invoice sync. Vendor-shaped implementations live in
 *  each adapter file; the routes depend only on this shape. */
export interface BillingAdapter {
  /** The backend id this adapter syncs to — matches `Invoice.externalRef.system`. */
  readonly id: string;
  /** Opt-in deploy gate (the adapter owns its own env flag / legacy alias, like the broker-url resolver). */
  enabled(env?: NodeJS.ProcessEnv): boolean;
  /** Push (create or idempotent update) the local invoice to the backend; returns the external ref to store. */
  push(ctx: ActorContext, invoice: Invoice, now: string): Promise<InvoiceExternalRef | null>;
  /** Pull the backend record back: refreshed external ref + whether the backend now reports it settled. */
  pull(ctx: ActorContext, invoice: Invoice, now: string): Promise<{ ref: InvoiceExternalRef | null; paid: boolean }>;
  /** The shared secret the inbound settlement webhook must present, or undefined ⇒ webhook disabled. */
  webhookSecret(env?: NodeJS.ProcessEnv): string | undefined;
  /** Normalise an inbound settlement webhook to `{ invoiceId, amount }`, or null when it isn't ours. */
  parseWebhook(raw: unknown): { invoiceId: string; amount: number | null } | null;
  /** The session-less actor context a webhook-driven state change is audited under. */
  systemContext(): ActorContext;
  /** Original vendor-named inbound URLs kept working as back-compat aliases (data — the neutral router mounts
   *  them alongside the neutral `/invoices/billing-webhook` path without naming the vendor itself). */
  readonly legacyWebhookPaths: readonly string[];
  /** Original vendor-named request headers the inbound webhook still accepts as back-compat aliases (data —
   *  the neutral router reads them alongside `x-billing-webhook-secret` without naming the vendor). */
  readonly legacyWebhookHeaders: readonly string[];
}

/** Every backend that implements gateway-side invoice sync, keyed by its backend id. Vendor names appear
 *  only here and in each adapter file — the sanctioned homes. */
const REGISTRY: Record<string, BillingAdapter> = {
  [invoiceNinjaBillingAdapter.id]: invoiceNinjaBillingAdapter,
};

/**
 * The billing adapter for the connected backend, or null when none applies. Resolution order:
 *  1. the adapter whose id matches the admin-set `backendSource` (the explicit, multi-backend-safe path);
 *  2. otherwise, if exactly one registered adapter is enabled by its deploy flag, that one — preserving the
 *     single-billing-backend behaviour of deploys that turned sync on without pinning `backendSource`.
 * Never guesses among several enabled adapters.
 */
export function resolveBillingAdapter(env: NodeJS.ProcessEnv = process.env): BillingAdapter | null {
  const backend = getSettings().backendSource?.trim();
  if (backend && REGISTRY[backend]) return REGISTRY[backend]!;
  const enabled = Object.values(REGISTRY).filter((a) => a.enabled(env));
  return enabled.length === 1 ? enabled[0]! : null;
}

/** All back-compat vendor-named webhook paths across every registered adapter (data). The neutral webhook
 *  router mounts these next to `/invoices/billing-webhook` so existing wiring keeps working after the rename. */
export function allLegacyWebhookPaths(): string[] {
  return Object.values(REGISTRY).flatMap((a) => [...a.legacyWebhookPaths]);
}

/** All back-compat vendor-named webhook header names across every registered adapter (data). The neutral
 *  webhook router accepts these next to `x-billing-webhook-secret` so existing wiring keeps working. */
export function allLegacyWebhookHeaders(): string[] {
  return Object.values(REGISTRY).flatMap((a) => [...a.legacyWebhookHeaders]);
}
