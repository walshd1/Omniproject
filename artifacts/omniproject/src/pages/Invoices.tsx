import { useState } from "react";
import { Receipt, Plus, Trash2 } from "lucide-react";
import { DataState } from "../components/DataState";
import {
  useInvoices, useInvoice, useCreateInvoice, useSetInvoiceStatus, useDeleteInvoice,
  invoiceActions, invoiceStatusTone, INVOICE_LINE_KINDS, invoiceLineAmount, formatMoney,
  type InvoiceStatus, type InvoiceLineKind, type InvoiceInput,
} from "../lib/invoices";

/**
 * Invoices (roadmap 3.3). List generated invoices with derived totals + a status flow, create a draft with
 * typed line primitives (labour/expense/fixed/discount — amounts derived), and move it through the lifecycle
 * (issue → paid, or void). Stored server-side in the sealed storage-target store; manager+ only. Behind the
 * default-off `invoicing` module.
 */

function StatusBadge({ status }: { status: InvoiceStatus }) {
  return <span className={`text-[10px] font-bold uppercase tracking-widest border px-1.5 py-0.5 ${invoiceStatusTone(status)}`}>{status}</span>;
}

interface DraftLine { kind: InvoiceLineKind; description: string; quantity: string; unitPrice: string }
const newLine = (): DraftLine => ({ kind: "labour", description: "", quantity: "1", unitPrice: "0" });

function CreateInvoiceForm({ onDone }: { onDone: () => void }) {
  const create = useCreateInvoice();
  const [number, setNumber] = useState("");
  const [clientName, setClientName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [taxRatePct, setTaxRatePct] = useState("0");
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const setLine = (i: number, patch: Partial<DraftLine>) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const preview = lines.reduce((acc, l) => acc + invoiceLineAmount(l.kind, Number(l.quantity) || 0, Number(l.unitPrice) || 0), 0);

  const submit = () => {
    const payload: InvoiceInput = {
      number: number.trim(), clientName: clientName.trim(), currency: currency.trim().toUpperCase(), storage: "org",
      taxRatePct: Number(taxRatePct) || 0,
      lines: lines.filter((l) => l.description.trim()).map((l) => ({ kind: l.kind, description: l.description.trim(), quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0 })),
    };
    if (!payload.number || !payload.clientName) return;
    create.mutate(payload, { onSuccess: onDone });
  };

  return (
    <div className="bg-card border border-border p-4 space-y-3" data-testid="invoice-create-form">
      <div className="flex gap-2">
        <input data-testid="invoice-number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Invoice #" className="w-32 border border-border bg-background px-2 py-1.5 text-sm" />
        <input data-testid="invoice-client" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client name" className="flex-1 border border-border bg-background px-2 py-1.5 text-sm" />
        <input aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-16 border border-border bg-background px-2 py-1.5 text-sm uppercase" />
      </div>
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Lines</div>
        {lines.map((l, i) => (
          <div key={i} className="flex gap-1.5">
            <select aria-label={`Line ${i + 1} kind`} value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value as InvoiceLineKind })} className="border border-border bg-background px-1 py-1 text-xs">
              {INVOICE_LINE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Description" className="flex-1 border border-border bg-background px-2 py-1 text-xs" />
            <input aria-label={`Line ${i + 1} quantity`} type="number" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} className="w-14 border border-border bg-background px-2 py-1 text-xs tabular-nums" />
            <span className="self-center text-xs text-muted-foreground">×</span>
            <input aria-label={`Line ${i + 1} unit price`} type="number" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} className="w-20 border border-border bg-background px-2 py-1 text-xs tabular-nums" />
            <span className="self-center text-xs tabular-nums w-20 text-right">{invoiceLineAmount(l.kind, Number(l.quantity) || 0, Number(l.unitPrice) || 0).toFixed(2)}</span>
          </div>
        ))}
        <button type="button" onClick={() => setLines((prev) => [...prev, newLine()])} className="text-xs text-primary hover:underline">+ Add line</button>
      </div>
      <div className="flex items-center gap-2 justify-between">
        <label className="text-xs text-muted-foreground flex items-center gap-1">Tax %<input aria-label="Tax rate" type="number" value={taxRatePct} onChange={(e) => setTaxRatePct(e.target.value)} className="w-14 border border-border bg-background px-2 py-1 text-xs tabular-nums" /></label>
        <span className="text-sm font-mono tabular-nums" data-testid="invoice-subtotal-preview">Subtotal {formatMoney(preview, currency.toUpperCase() || "USD")}</span>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={!number.trim() || !clientName.trim() || create.isPending} data-testid="invoice-create-submit" className="border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-black uppercase tracking-widest disabled:opacity-40">{create.isPending ? "Saving…" : "Create draft"}</button>
        <button type="button" onClick={onDone} className="border border-border px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:bg-muted/40">Cancel</button>
      </div>
      {create.isError && <p className="text-xs text-red-600">Couldn't create the invoice.</p>}
    </div>
  );
}

function InvoiceDetail({ id }: { id: string }) {
  const { data: inv, isLoading, isError, error, refetch } = useInvoice(id);
  const setStatus = useSetInvoiceStatus();
  const del = useDeleteInvoice();

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {inv && (
        <div className="space-y-3" data-testid="invoice-detail">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">{inv.number} <StatusBadge status={inv.status} /></h2>
              <p className="text-sm text-muted-foreground">{inv.clientName}</p>
            </div>
            <button type="button" aria-label="Delete invoice" onClick={() => del.mutate(inv.id)} className="text-muted-foreground hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
          </div>
          <table className="w-full text-xs border-collapse">
            <tbody>
              {inv.lines.map((l) => (
                <tr key={l.id} className="border-b border-border/50">
                  <td className="py-1 pr-2"><span className="text-[10px] uppercase text-muted-foreground mr-1">{l.kind}</span>{l.description}</td>
                  <td className="py-1 px-2 text-right tabular-nums text-muted-foreground">{l.quantity} × {l.unitPrice}</td>
                  <td className="py-1 pl-2 text-right tabular-nums">{formatMoney(l.amount, inv.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-right text-sm space-y-0.5 tabular-nums">
            <div className="text-muted-foreground">Subtotal {formatMoney(inv.subtotal, inv.currency)}</div>
            <div className="text-muted-foreground">Tax ({inv.taxRatePct}%) {formatMoney(inv.taxAmount, inv.currency)}</div>
            <div className="font-black" data-testid="invoice-total">Total {formatMoney(inv.total, inv.currency)}</div>
          </div>
          <div className="flex gap-2">
            {invoiceActions(inv.status).map((next) => (
              <button key={next} type="button" onClick={() => setStatus.mutate({ id: inv.id, status: next })} disabled={setStatus.isPending} data-testid={`invoice-to-${next}`} className="border border-border px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:bg-muted/40 disabled:opacity-40">
                {next === "issued" ? "Issue" : next === "paid" ? "Mark paid" : "Void"}
              </button>
            ))}
          </div>
        </div>
      )}
    </DataState>
  );
}

export function Invoices() {
  const { data: invoices, isLoading, isError, error, refetch } = useInvoices();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black uppercase tracking-widest flex items-center gap-2"><Receipt className="w-5 h-5" />Invoices</h1>
        <button type="button" onClick={() => setCreating((c) => !c)} data-testid="invoice-new" className="inline-flex items-center gap-1.5 border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-black uppercase tracking-widest"><Plus className="w-3.5 h-3.5" />New invoice</button>
      </div>
      {creating && <CreateInvoiceForm onDone={() => setCreating(false)} />}
      <div className="grid md:grid-cols-2 gap-4">
        <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
          <div className="space-y-2" data-testid="invoice-list">
            {(invoices ?? []).length === 0 && !creating && <p className="text-sm text-muted-foreground">No invoices yet. Create a draft to bill a client.</p>}
            {(invoices ?? []).map((inv) => (
              <button key={inv.id} type="button" onClick={() => setSelected(inv.id)} data-testid={`invoice-row-${inv.id}`} className={`w-full text-left border p-3 hover:bg-muted/20 ${selected === inv.id ? "border-primary" : "border-border"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold truncate">{inv.number} · {inv.clientName}</span>
                  <StatusBadge status={inv.status} />
                </div>
                <div className="text-sm font-mono tabular-nums mt-1">{formatMoney(inv.total, inv.currency)}</div>
              </button>
            ))}
          </div>
        </DataState>
        <div>{selected ? <InvoiceDetail id={selected} /> : <p className="text-sm text-muted-foreground">Select an invoice to view its lines and move it through issue → paid.</p>}</div>
      </div>
    </div>
  );
}
