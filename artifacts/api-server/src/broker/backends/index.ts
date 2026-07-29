/**
 * Backend billing-adapter SEAM — the neutral boundary between the gateway's invoice routes and a backend's
 * outbound billing sync (push / pull-back / inbound settlement webhook).
 *
 * There is NO vendor code here or anywhere above it. A backend that supports invoice sync ADVERTISES its
 * mapping as data in its catalogue manifest (`invoiceSync`, see backend-manifest.ts); this seam resolves that
 * spec for the connected `backendSource` and hands the routes a generic {@link BillingAdapter} whose push/pull/
 * webhook are the generic projector (`./invoice-mapping`) applied to the advertised spec. Adding a billing
 * backend is a manifest `invoiceSync` block — zero code.
 *
 * Only invoice sync needs an adapter at all: ordinary contract verbs (create/get/list_*) are already executed
 * backend-agnostically from the manifest's `actions`. Sync is the exception because it reconciles an EXTERNAL
 * settlement onto a LOCAL sealed invoice artifact (gateway-owned), so the neutral glue (store the ref, advance
 * status) lives above the seam and the vendor-shaped mapping lives in the advertised data.
 */
import type { ActorContext } from "../types";
import type { Invoice, InvoiceExternalRef } from "../../lib/invoice";
import type { ContractAction, InvoiceSyncSpec } from "@workspace/backend-catalogue";
import { BACKENDS, getBackend } from "@workspace/backend-catalogue";
import { getSettings } from "../../lib/settings";
import { brokerCommand } from "..";
import * as mapping from "./invoice-mapping";

/** Audit/source tag carried on every bridged command — the `invoicing` feature domain (backend-neutral). */
const BILLING_SOURCE = "invoicing";

/** The neutral capability surface the invoice routes depend on. One generic implementation, built per backend
 *  from its advertised {@link InvoiceSyncSpec}. */
export interface BillingAdapter {
  readonly id: string;
  enabled(env?: NodeJS.ProcessEnv): boolean;
  push(ctx: ActorContext, invoice: Invoice, now: string): Promise<InvoiceExternalRef | null>;
  pull(ctx: ActorContext, invoice: Invoice, now: string): Promise<{ ref: InvoiceExternalRef | null; paid: boolean }>;
  webhookSecret(env?: NodeJS.ProcessEnv): string | undefined;
  parseWebhook(raw: unknown): { invoiceId: string; amount: number | null } | null;
  systemContext(): ActorContext;
  readonly legacyWebhookPaths: readonly string[];
  readonly legacyWebhookHeaders: readonly string[];
}

/** Build the generic adapter for a backend from its advertised invoice-sync spec. */
function buildAdapter(id: string, label: string, spec: InvoiceSyncSpec): BillingAdapter {
  const externalId = (invoice: Invoice): string | null =>
    invoice.externalRef?.system === id ? invoice.externalRef.id : null;
  return {
    id,
    enabled: (env = process.env) => mapping.syncEnabled(spec, env),
    async push(ctx, invoice, now) {
      const payload = mapping.projectOutbound(invoice as unknown as Record<string, unknown>, spec);
      const existing = externalId(invoice);
      const op: ContractAction = existing ? "update_invoice" : "create_invoice";
      if (existing) payload["invoiceId"] = existing; // the update route keys off this
      const result = await brokerCommand(ctx, op, payload, BILLING_SOURCE);
      return mapping.parseExternalRef(result, spec, id, now);
    },
    async pull(ctx, invoice, now) {
      const ext = externalId(invoice);
      if (!ext) return { ref: null, paid: false };
      const result = await brokerCommand(ctx, "get_invoice", { invoiceId: ext }, BILLING_SOURCE);
      return { ref: mapping.parseExternalRef(result, spec, id, now), paid: mapping.parsePaid(result, spec) === "paid" };
    },
    webhookSecret: (env = process.env) => mapping.webhookSecret(spec, env),
    parseWebhook: (raw) => mapping.parseWebhook(raw, spec),
    // Session-less automation actor: invoices are org/project scoped (never personal), so no `sub` is needed to
    // resolve their store; this only labels the audit trail + marks the change as automation-initiated.
    systemContext: () => ({ sub: `system:${id}`, name: `${label} (webhook)`, role: "manager", actorKind: "automation" }),
    legacyWebhookPaths: spec.webhook.legacyPaths ?? [],
    legacyWebhookHeaders: spec.webhook.legacyHeaders ?? [],
  };
}

/** Every backend that advertises invoice sync, as `[def, spec]`. */
function billingBackends(): Array<{ id: string; label: string; spec: InvoiceSyncSpec }> {
  return BACKENDS.filter((b) => b.invoiceSync).map((b) => ({ id: b.id, label: b.label, spec: b.invoiceSync! }));
}

/**
 * The billing adapter for the connected backend, or null when none applies. Resolution order:
 *  1. the adapter for the admin-set `backendSource` (explicit, multi-backend-safe);
 *  2. otherwise, if exactly one advertised billing backend is enabled by its deploy flag, that one —
 *     preserving the single-billing-backend behaviour of deploys that turned sync on without pinning
 *     `backendSource`. Never guesses among several enabled adapters.
 */
export function resolveBillingAdapter(env: NodeJS.ProcessEnv = process.env): BillingAdapter | null {
  const backend = getSettings().backendSource?.trim();
  if (backend) {
    const def = getBackend(backend);
    if (def?.invoiceSync) return buildAdapter(def.id, def.label, def.invoiceSync);
  }
  const enabled = billingBackends().filter((b) => mapping.syncEnabled(b.spec, env));
  return enabled.length === 1 ? buildAdapter(enabled[0]!.id, enabled[0]!.label, enabled[0]!.spec) : null;
}

/** All back-compat vendor-named webhook paths advertised across every billing backend (data). The neutral
 *  webhook router mounts these next to `/invoices/billing-webhook` so existing wiring keeps working. */
export function allLegacyWebhookPaths(): string[] {
  return billingBackends().flatMap((b) => b.spec.webhook.legacyPaths ?? []);
}

/** All back-compat vendor-named webhook header names advertised across every billing backend (data). */
export function allLegacyWebhookHeaders(): string[] {
  return billingBackends().flatMap((b) => b.spec.webhook.legacyHeaders ?? []);
}
