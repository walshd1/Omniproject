import type { ReactNode } from "react";
import { useGetCapabilities, type ProgrammeFinancials } from "@workspace/api-client-react";
import { useT } from "../lib/i18n";
import { useDisplayCurrency, DEFAULT_CURRENCY } from "../lib/currency";
import { RAG_TEXT as HEALTH } from "../lib/methodology";
import { ReportingBadge } from "./ReportingBadge";

function Stat({ label, value, accent, badge }: { label: string; value: string; accent?: string | undefined; badge?: ReactNode }) {
  return (
    <div className="border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-[10px] text-muted-foreground uppercase tracking-widest">{label}</div>
        {badge}
      </div>
      <div className={`text-lg font-black font-mono ${accent ?? ""}`}>{value}</div>
    </div>
  );
}

/**
 * Programme-wide financial roll-up (budget, actuals, variance, committed, EVM),
 * summed from member projects by the gateway. Capability-gated: renders nothing
 * when the backend can't surface financials. Amounts arrive in the backend's
 * native currency and convert to a chosen display currency (multi-currency
 * portfolios), reusing the same FX path as the EVM report.
 */
export function ProgrammeFinancialsCard({ financials }: { financials: ProgrammeFinancials }) {
  const { data: caps } = useGetCapabilities();
  const { formatCurrency } = useT();
  const native = financials.currency || DEFAULT_CURRENCY;
  const { displayCcy, setDisplay, convert, currencyOptions } = useDisplayCurrency(native);

  // Hide entirely when the backend declares no financials domain.
  if (caps?.financials === false) return null;

  const money = (n: number) => formatCurrency(convert(n), displayCcy);

  const overspend = financials.variance < 0;
  const rep = financials.reporting;

  return (
    <section data-testid="programme-financials">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Financials</h2>
          {/* Headline coverage: how many member projects carry financials at all. */}
          {financials.reporting && financials.reporting.costed < financials.reporting.total && (
            <ReportingBadge present={financials.reporting.costed} total={financials.reporting.total} noun="carry financials" />
          )}
        </div>
        <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          Display currency
          <select
            value={displayCcy}
            onChange={(e) => setDisplay(e.target.value)}
            aria-label="Display currency"
            className="bg-background border border-border px-2 py-1 text-xs font-mono uppercase outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {currencyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <div className="bg-card border border-border p-6 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Budget" value={money(financials.budget)} />
          <Stat label="Actual cost" value={money(financials.actualCost)} />
          <Stat
            label="Variance"
            value={`${overspend ? "−" : "+"}${money(Math.abs(financials.variance))}${financials.variancePct != null ? ` (${financials.variancePct}%)` : ""}`}
            accent={overspend ? "text-red-500" : "text-green-500"}
          />
          <Stat label="Health" value={financials.health} accent={HEALTH[financials.health]} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Committed: complete → value + green badge; partial → flagged, not hidden. */}
          {financials.committed != null ? (
            <Stat label="Committed (PO)" value={money(financials.committed)}
              badge={rep && <ReportingBadge present={rep.committed} total={rep.costed} noun="report committed" />} />
          ) : rep && rep.committed > 0 ? (
            <Stat label="Committed (PO)" value="Partial" accent="text-amber-500"
              badge={<ReportingBadge present={rep.committed} total={rep.costed} noun="report committed" />} />
          ) : null}
          {/* Earned value: the silent-degradation fix — show coverage, don't vanish. */}
          {financials.earnedValue != null ? (
            <Stat label="Earned value" value={money(financials.earnedValue)}
              badge={rep && <ReportingBadge present={rep.earnedValue} total={rep.costed} noun="report earned value" />} />
          ) : rep && rep.earnedValue > 0 ? (
            <Stat label="Earned value" value="Partial" accent="text-amber-500"
              badge={<ReportingBadge present={rep.earnedValue} total={rep.costed} noun="report earned value" />} />
          ) : null}
          {financials.cpi != null ? (
            <Stat label="CPI" value={financials.cpi.toFixed(2)} accent={financials.cpi < 1 ? "text-red-500" : "text-green-500"} />
          ) : rep && rep.earnedValue > 0 && rep.earnedValue < rep.costed ? (
            <Stat label="CPI" value="—" accent="text-amber-500"
              badge={<span className="text-[9px] uppercase tracking-widest text-amber-500" title="CPI needs earned value from every costed project">needs full EV</span>} />
          ) : null}
          <Stat label="Projects costed" value={String(financials.projectsCounted)} />
        </div>
        <p className="text-[11px] text-muted-foreground font-mono">
          Rolled up from member projects' financial fields. CPI = EV/AC. A
          “<span className="text-amber-500">n/m reporting</span>” badge means only some
          costed projects supply that metric — the figure is not complete.
        </p>
      </div>
    </section>
  );
}
