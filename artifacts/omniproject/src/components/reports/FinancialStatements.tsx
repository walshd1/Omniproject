import { useMemo } from "react";
import { type Issue } from "@workspace/api-client-react";
import { useProjectIssuesMoney } from "../../lib/currency";
import { summariseStatements } from "../../lib/financial-statements";
import { DataState } from "../DataState";
import { ReportEmpty } from "./ReportEmpty";
import { ReportTable } from "./ReportTable";
import { StatCard } from "./StatCard";

/**
 * Financial statements (finance superset F9) — the consolidated finance view. STATELESS: a project-level
 * PROFIT & LOSS (income − cost → gross profit + margin) and a RECEIVABLES summary (invoiced vs unbilled),
 * derived live from the canonical `revenue` / `actualCost` / `invoicedAmount` fields the backend surfaces.
 *
 * Balance sheet, cash-flow statement and aged AP are GL/banking-backed (the F7/F8 contract verbs) — they
 * populate when a ledger/banking backend is connected and returning that data, so we say so plainly rather
 * than render empty promises.
 */
export function FinancialStatements({ projectId }: { projectId: string }) {
  const { issues, money, isLoading, isError, error, refetch } = useProjectIssuesMoney(projectId);

  const s = useMemo(() => summariseStatements((issues ?? []) as Issue[]), [issues]);

  const pnl = useMemo(
    () => [
      { line: "Income (revenue)", amount: s.income },
      { line: "Cost of delivery (actual cost)", amount: -s.cost },
      { line: "Gross profit", amount: s.grossProfit, total: true },
    ],
    [s],
  );

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {s.count === 0 ? (
        <ReportEmpty testId="statements-empty">
          No finance data — set income (revenue), actual cost and invoiced amounts on work items, or connect a
          finance backend, to see the statements.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="financial-statements">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Income" value={money(s.income)} hint={`${s.count} item(s)`} />
            <StatCard label="Cost" value={money(s.cost)} hint="actual cost of delivery" />
            <StatCard label="Gross profit" value={money(s.grossProfit)} hint={s.grossProfit >= 0 ? "in profit" : "at a loss"} />
            <StatCard label="Margin" value={`${s.marginPct}%`} hint="gross profit ÷ income" />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Profit &amp; loss</div>
            <ReportTable
              rows={pnl}
              rowKey={(r) => r.line}
              rowTestId={(r) => `pnl-${r.line}`}
              columns={[
                { header: "Line", cell: (r) => r.line, cellClassName: (r) => (r.total ? "font-bold" : "") },
                { header: "Amount", align: "right", cell: (r) => money(r.amount), cellClassName: (r) => (r.total ? "font-bold" : r.amount < 0 ? "text-amber-600" : "") },
              ]}
            />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Receivables</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatCard label="Invoiced" value={money(s.invoiced)} hint="billed to date" />
              <StatCard label="Unbilled" value={money(s.unbilled)} hint="income earned, not yet billed" />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Consolidated P&amp;L and receivables across {s.count} item(s), derived live from the project&apos;s
            finance fields; nothing is stored. The balance sheet, cash-flow statement and aged payables populate
            when a general-ledger / banking backend (the finance-superset ledger &amp; banking verbs) is
            connected and returning that data.
          </p>
        </div>
      )}
    </DataState>
  );
}
