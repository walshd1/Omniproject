import { ReportEmpty } from "./ReportEmpty";
import { useMemo } from "react";
import { type Issue } from "@workspace/api-client-react";
import { summariseCapex } from "../../lib/capex";
import { useProjectIssuesMoney } from "../../lib/currency";
import { truncateLabel } from "../../lib/utils";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { ChartView } from "../charts/ChartView";

/**
 * CapEx / OpEx report. STATELESS: it splits the project's spend into capital vs operating from the
 * canonical `expenditureType` / `capexAmount` / `opexAmount` fields (falling back to the declared
 * type + cost), rolls up by cost category, and derives the annual capital charge from each item's
 * depreciation period. Nothing is stored.
 */

export function CapexOpex({ projectId }: { projectId: string }) {
  const { issues, money, isLoading, isError, error, refetch } = useProjectIssuesMoney(projectId);

  const summary = useMemo(() => summariseCapex((issues ?? []) as Issue[]), [issues]);

  const catData = useMemo(
    () => summary.byCategory.slice(0, 8).map((c) => ({ name: truncateLabel(c.category), capex: c.capex, opex: c.opex })),
    [summary],
  );

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {summary.count === 0 ? (
        <ReportEmpty testId="capex-empty">
          No capitalisation data — set an expenditure type (capex/opex) and amounts on work items to see the CapEx/OpEx split.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="capex-opex">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Capital (CapEx)" value={money(summary.totalCapex)} hint={`${Math.round(summary.capexPct * 100)}% of spend`} />
            <StatCard label="Operating (OpEx)" value={money(summary.totalOpex)} />
            <StatCard label="Total classified" value={money(summary.total)} />
            <StatCard label="Annual capital charge" value={money(summary.annualisedCapex)} hint="capex ÷ useful life" />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">CapEx / OpEx by cost category</div>
            <ChartView
              type="bar"
              stacked
              height={Math.max(160, catData.length * 38)}
              data={catData}
              valueFormatter={money}
              palette={["#2563eb", "#d97706"]}
              series={[{ key: "capex", label: "CapEx" }, { key: "opex", label: "OpEx" }]}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-bold">Item</th>
                  <th className="py-1.5 px-2 font-bold">Category</th>
                  <th className="py-1.5 px-2 font-bold text-right">CapEx</th>
                  <th className="py-1.5 px-2 font-bold text-right">OpEx</th>
                  <th className="py-1.5 px-2 font-bold text-right">Annual charge</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50" data-testid={`capex-row-${r.id}`}>
                    <td className="py-1.5 pr-3 font-mono truncate max-w-[16rem]">{r.title}</td>
                    <td className="py-1.5 px-2 text-muted-foreground">{r.category}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{r.capex ? money(r.capex) : "—"}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{r.opex ? money(r.opex) : "—"}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{r.annualCharge ? money(r.annualCharge) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Capital vs operating split across {summary.count} classified item(s), rolled up by cost category.
            The annual capital charge spreads capitalised spend over each item's depreciation period — nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
