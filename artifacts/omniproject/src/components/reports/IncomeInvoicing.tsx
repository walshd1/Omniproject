import { ReportEmpty } from "./ReportEmpty";
import { useMemo } from "react";
import { ChartView } from "../charts/ChartView";
import { type Issue } from "@workspace/api-client-react";
import { summariseIncome } from "../../lib/income";
import { useProjectIssuesMoney } from "../../lib/currency";
import { truncateLabel } from "../../lib/utils";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";

/**
 * Income & Invoicing report. STATELESS: projected income (`revenue`) vs what's actually been invoiced
 * (`invoicedAmount`) per work item, with the unbilled gap and purchase-order references. Nothing stored.
 */
export function IncomeInvoicing({ projectId }: { projectId: string }) {
  const { issues, money, isLoading, isError, error, refetch } = useProjectIssuesMoney(projectId);

  const summary = useMemo(() => summariseIncome((issues ?? []) as Issue[]), [issues]);

  const chart = useMemo(
    () => summary.rows.slice(0, 8).map((r) => ({ name: truncateLabel(r.title), invoiced: r.invoiced, unbilled: Math.max(0, r.unbilled) })),
    [summary],
  );

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {summary.count === 0 ? (
        <ReportEmpty testId="income-empty">
          No income data — set projected income (revenue) and invoiced amounts on work items to track billing.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="income-invoicing">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Projected income" value={money(summary.projected)} hint={`${summary.count} item(s)`} />
            <StatCard label="Invoiced" value={money(summary.invoiced)} hint={`${summary.billedPct}% billed`} />
            <StatCard label="Unbilled" value={money(summary.unbilled)} hint="projected − invoiced" />
            <StatCard label="Billed" value={`${summary.billedPct}%`} hint={summary.billedPct >= 100 ? "fully invoiced" : "billing outstanding"} />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Invoiced vs unbilled by item</div>
            <ChartView type="bar" stacked height={Math.max(160, chart.length * 38)} data={chart} valueFormatter={money}
              series={[{ key: "invoiced", label: "Invoiced" }, { key: "unbilled", label: "Unbilled" }]} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-bold">Item</th>
                  <th className="py-1.5 px-2 font-bold">PO</th>
                  <th className="py-1.5 px-2 font-bold text-right">Projected</th>
                  <th className="py-1.5 px-2 font-bold text-right">Invoiced</th>
                  <th className="py-1.5 px-2 font-bold text-right">Unbilled</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50" data-testid={`income-row-${r.id}`}>
                    <td className="py-1.5 pr-3 truncate max-w-[16rem]">{r.title}</td>
                    <td className="py-1.5 px-2 font-mono text-muted-foreground">{r.purchaseOrder ?? "—"}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{money(r.revenue)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{money(r.invoiced)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-amber-600">{r.unbilled ? money(r.unbilled) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Projected income vs invoiced across {summary.count} item(s); the unbilled gap is work to bill. PO
            references carry through from the backend. Derived live; nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
