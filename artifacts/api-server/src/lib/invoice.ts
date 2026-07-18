/**
 * INVOICE server logic (roadmap 3.3) — the authoritative sanitiser + storage access for first-class generated
 * invoices. An invoice is a client-facing document: a number, a currency, and a list of typed LINE PRIMITIVES
 * (labour/expense/fixed/discount — the `invoiceLine` family in the unified store), whose amounts and the
 * invoice totals are DERIVED server-side, never trusted from the client. Invoices live in the scoped,
 * AES-256-GCM-sealed artifact store (project / org — an invoice is not personal), exactly like goals/proofs;
 * ids are self-describing so a read routes to the right store. `sanitizeInvoiceWrite` is the single choke
 * point every write passes through.
 */
import type { ActorContext } from "../broker/types";
import { makeScopedId, parseScopedId, scopeFromParsed, type ArtifactScope, type StorageTarget } from "./artifact-store";
import { sanitizeText as cleanText } from "./coerce";
import {
  INVOICE_LINE_KINDS, INVOICE_STATUSES, invoiceLineAmount, round2,
  type InvoiceLineKind, type InvoiceStatus,
} from "@workspace/backend-catalogue";

const INVOICE_STATUS_SET = new Set<string>(INVOICE_STATUSES);
export const isInvoiceStatus = (s: unknown): s is InvoiceStatus => typeof s === "string" && INVOICE_STATUS_SET.has(s);

/** Allowed status transitions. draft→issued→paid is the happy path; a live invoice can be voided; paid/void
 *  are terminal. Keyed by the CURRENT status → the set of statuses it may move to. */
export const INVOICE_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["issued", "void"],
  issued: ["paid", "void"],
  paid: [],
  void: [],
};

/** Whether an invoice may move from `from` to `to`. Pure. */
export const canTransitionInvoice = (from: InvoiceStatus, to: InvoiceStatus): boolean =>
  (INVOICE_TRANSITIONS[from] ?? []).includes(to);

/** A rejected invoice write (maps to 400). */
export class InvoiceError extends Error {
  constructor(message: string) { super(message); this.name = "InvoiceError"; }
}

/** The artifact-store type key for invoices. */
export const INVOICE_ARTIFACT = "invoice";

/** Invoices live in the project / org encrypted-JSON areas (never personal, never sidecar). */
export type InvoiceStorage = "project" | "org";
const INVOICE_STORAGE_SET = new Set<InvoiceStorage>(["project", "org"]);
const isInvoiceStorage = (s: unknown): s is InvoiceStorage => typeof s === "string" && INVOICE_STORAGE_SET.has(s as InvoiceStorage);

const LINE_KIND_SET = new Set<string>(INVOICE_LINE_KINDS);
const isLineKind = (k: unknown): k is InvoiceLineKind => typeof k === "string" && LINE_KIND_SET.has(k);

export const INVOICE_LIMITS = {
  maxNumber: 64,
  maxClientName: 200,
  maxLineDescription: 500,
  maxLines: 200,
  maxNote: 4000,
  maxInvoiceBytes: 256 * 1024,
} as const;

/** One priced invoice line (a typed `invoiceLine` primitive). `amount` is derived from kind × qty × price. */
export interface InvoiceLine {
  id: string;
  kind: InvoiceLineKind;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

/** A stored invoice row. Amounts + totals are server-derived. */
export interface Invoice {
  id: string;
  number: string;
  clientName: string;
  projectId: string | null;
  currency: string;
  status: InvoiceStatus;
  lines: InvoiceLine[];
  subtotal: number;
  taxRatePct: number;
  taxAmount: number;
  total: number;
  note: string | null;
  dueAt: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  ownerSub: string | null;
  storage: InvoiceStorage;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

/** The list projection of an invoice (lines dropped). */
export interface InvoiceMeta {
  id: string;
  number: string;
  clientName: string;
  currency: string;
  status: InvoiceStatus;
  total: number;
  lineCount: number;
  projectId?: string | null;
  storage?: InvoiceStorage;
  dueAt: string | null;
  updatedAt: string;
}

export interface SanitizedInvoiceWrite {
  number: string;
  clientName: string;
  currency: string;
  taxRatePct: number;
  note: string | null;
  dueAt: string | null;
  lines: InvoiceLine[];
  storage: InvoiceStorage;
  projectId?: string;
}

const num = (v: unknown, def = 0): number => { const n = Number(v); return Number.isFinite(n) ? n : def; };

/** Normalise a currency to a 3-letter uppercase ISO-4217-ish code (defaults to the FX base later if absent). */
function cleanCurrency(v: unknown): string {
  const s = cleanText(v, 8).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : "";
}

/** Sanitise one invoice line, deriving its amount from the kind. Throws {@link InvoiceError}. */
export function sanitizeInvoiceLine(raw: unknown, index: number): InvoiceLine {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new InvoiceError("each line must be an object");
  const obj = raw as Record<string, unknown>;
  const description = cleanText(obj["description"], INVOICE_LIMITS.maxLineDescription).trim();
  if (!description) throw new InvoiceError("a line needs a description");
  const kind: InvoiceLineKind = isLineKind(obj["kind"]) ? obj["kind"] : "fixed";
  const quantity = num(obj["quantity"], 1);
  const unitPrice = num(obj["unitPrice"], 0);
  return {
    id: cleanText(obj["id"], 64) || `line-${index + 1}`,
    kind,
    description,
    quantity,
    unitPrice,
    amount: invoiceLineAmount(kind, quantity, unitPrice),
  };
}

/** Sanitise the whole line list (bound the count). */
export function sanitizeInvoiceLines(raw: unknown): InvoiceLine[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new InvoiceError("lines must be an array");
  if (raw.length > INVOICE_LIMITS.maxLines) throw new InvoiceError(`an invoice may have at most ${INVOICE_LIMITS.maxLines} lines`);
  return raw.map((l, i) => sanitizeInvoiceLine(l, i));
}

/** Compute the derived totals from lines + a tax rate. Pure. */
export function computeTotals(lines: readonly InvoiceLine[], taxRatePct: number): { subtotal: number; taxAmount: number; total: number } {
  const subtotal = round2(lines.reduce((acc, l) => acc + l.amount, 0));
  const taxAmount = round2(subtotal * (taxRatePct / 100));
  return { subtotal, taxAmount, total: round2(subtotal + taxAmount) };
}

/** Sanitise a whole invoice write — the single choke point for POST/PUT. Throws {@link InvoiceError} (→ 400). */
export function sanitizeInvoiceWrite(raw: unknown): SanitizedInvoiceWrite {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const number = cleanText(obj["number"], INVOICE_LIMITS.maxNumber).trim();
  if (!number) throw new InvoiceError("an invoice needs a number");
  const clientName = cleanText(obj["clientName"], INVOICE_LIMITS.maxClientName).trim();
  if (!clientName) throw new InvoiceError("an invoice needs a client name");
  const currency = cleanCurrency(obj["currency"]);
  if (!currency) throw new InvoiceError("an invoice needs a 3-letter currency code");
  const taxRatePct = Math.min(100, Math.max(0, num(obj["taxRatePct"], 0)));
  const lines = sanitizeInvoiceLines(obj["lines"]);
  const note = cleanText(obj["note"], INVOICE_LIMITS.maxNote).trim();
  const dueAtRaw = cleanText(obj["dueAt"], 40).trim();
  const dueAt = dueAtRaw && !Number.isNaN(Date.parse(dueAtRaw)) ? dueAtRaw : null;
  const storage: InvoiceStorage = isInvoiceStorage(obj["storage"]) ? obj["storage"] : "project";
  const out: SanitizedInvoiceWrite = { number, clientName, currency, taxRatePct, note: note || null, dueAt, lines, storage };
  const projectId = obj["projectId"];
  if (typeof projectId === "string" && projectId.trim()) out.projectId = projectId.trim();
  if (storage === "project" && !out.projectId) throw new InvoiceError("a project invoice needs a projectId");
  const serialized = JSON.stringify({ number, clientName, lines });
  if (serialized.length > INVOICE_LIMITS.maxInvoiceBytes) throw new InvoiceError("the invoice is too large");
  return out;
}

// ── Storage-target model ─────────────────────────────────────────────────────────────────────────────────

export const makeInvoiceId = (storage: InvoiceStorage, localId: string, projectId?: string): string =>
  makeScopedId(storage as StorageTarget, localId, projectId);

export function parseInvoiceId(id: string): { storage: InvoiceStorage; projectId?: string; localId: string } | null {
  const parsed = parseScopedId(id);
  if (!parsed || !isInvoiceStorage(parsed.storage)) return null;
  return parsed.projectId !== undefined
    ? { storage: parsed.storage, projectId: parsed.projectId, localId: parsed.localId }
    : { storage: parsed.storage, localId: parsed.localId };
}

export const invoiceScope = (parsed: { storage: InvoiceStorage; projectId?: string }, sub: string | undefined): ArtifactScope | null =>
  scopeFromParsed(parsed as { storage: StorageTarget; projectId?: string }, sub);

export const actorLabel = (ctx: ActorContext): string | null => ctx.email ?? ctx.name ?? ctx.sub ?? null;

/** Build the row for a NEW invoice (owner stamped from ctx; totals derived; status draft; version 1). */
export function newInvoiceRow(id: string, input: SanitizedInvoiceWrite, ctx: ActorContext, now: string): Invoice {
  const totals = computeTotals(input.lines, input.taxRatePct);
  return {
    id,
    number: input.number,
    clientName: input.clientName,
    projectId: input.projectId ?? null,
    currency: input.currency,
    status: "draft",
    lines: input.lines,
    subtotal: totals.subtotal,
    taxRatePct: input.taxRatePct,
    taxAmount: totals.taxAmount,
    total: totals.total,
    note: input.note,
    dueAt: input.dueAt,
    issuedAt: null,
    paidAt: null,
    ownerSub: ctx.sub ?? null,
    storage: input.storage,
    version: 1,
    createdAt: now,
    updatedAt: now,
    updatedBy: actorLabel(ctx),
  };
}

/** Apply an UPDATE, preserving id/owner/storage/status/timestamps; totals recomputed. */
export function mergeInvoiceRow(existing: Invoice, input: SanitizedInvoiceWrite, ctx: ActorContext, now: string): Invoice {
  const totals = computeTotals(input.lines, input.taxRatePct);
  return {
    ...existing,
    number: input.number,
    clientName: input.clientName,
    projectId: input.projectId ?? existing.projectId ?? null,
    currency: input.currency,
    lines: input.lines,
    subtotal: totals.subtotal,
    taxRatePct: input.taxRatePct,
    taxAmount: totals.taxAmount,
    total: totals.total,
    note: input.note,
    dueAt: input.dueAt,
    version: (existing.version ?? 1) + 1,
    updatedAt: now,
    updatedBy: actorLabel(ctx),
  };
}

/**
 * Move an invoice to `next` status (assumes the transition was validated by {@link canTransitionInvoice}).
 * Stamps `issuedAt` on issue and `paidAt` on pay; bumps the version. Pure.
 */
export function applyInvoiceStatus(existing: Invoice, next: InvoiceStatus, ctx: ActorContext, now: string): Invoice {
  return {
    ...existing,
    status: next,
    issuedAt: next === "issued" ? now : existing.issuedAt,
    paidAt: next === "paid" ? now : existing.paidAt,
    version: (existing.version ?? 1) + 1,
    updatedAt: now,
    updatedBy: actorLabel(ctx),
  };
}

/** The metadata view of an invoice (lines dropped) — the list projection. */
export function invoiceMeta(inv: Invoice): InvoiceMeta {
  const meta: InvoiceMeta = {
    id: inv.id,
    number: inv.number,
    clientName: inv.clientName,
    currency: inv.currency,
    status: inv.status ?? "draft",
    total: inv.total ?? 0,
    lineCount: inv.lines?.length ?? 0,
    dueAt: inv.dueAt ?? null,
    updatedAt: inv.updatedAt,
  };
  if (inv.projectId !== undefined) meta.projectId = inv.projectId;
  if (inv.storage !== undefined) meta.storage = inv.storage;
  return meta;
}
