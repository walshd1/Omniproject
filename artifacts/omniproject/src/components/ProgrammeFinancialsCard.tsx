import { useState } from "react";
import { useGetCapabilities, type ProgrammeFinancials } from "@workspace/api-client-react";
import { useT } from "../lib/i18n";
import { useFxRates, convertAmount, currencyList } from "../lib/currency";

const HEALTH: Record<string, string> = { GREEN: "text-green-500", AMBER: "text-amber-500", RED: "text-red-500" };

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="border border-border bg-background p-3">
      <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">{label}</div>
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
  const { data: fx } = useFxRates();
  const [display, setDisplay] = useState("");

  // Hide entirely when the backend declares no financials domain.
  if (caps?.financials === false) return null;

  const native = financials.currency || "GBP";
  const displayCcy = display || native;
  const money = (n: number) => formatCurrency(convertAmount(n, native, displayCcy, fx?.rates), displayCcy);
  const currencyOptions = Array.from(new Set([native, ...currencyList(fx?.rates)]));

  const overspend = financials.variance < 0;

  return (
    <section data-testid="programme-financials">
      <div className="flex items-center justify-between mb-4 gap-3">
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Financials</h2>
        <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          Display currency
          <select
            value={displayCcy}
            onChange={(e) => setDisplay(e.target.value)}
            aria-label="Display currency"
            className="bg-background border border-border px-2 py-1 text-xs font-mono uppercase outline-none"
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
          {financials.committed != null && <Stat label="Committed (PO)" value={money(financials.committed)} />}
          {financials.earnedValue != null && <Stat label="Earned value" value={money(financials.earnedValue)} />}
          {financials.cpi != null && (
            <Stat label="CPI" value={financials.cpi.toFixed(2)} accent={financials.cpi < 1 ? "text-red-500" : "text-green-500"} />
          )}
          <Stat label="Projects costed" value={String(financials.projectsCounted)} />
        </div>
        <p className="text-[11px] text-muted-foreground font-mono">
          Rolled up from member projects' financial fields. CPI = EV/AC. Shown only where the backend supplies a finance source.
        </p>
      </div>
    </section>
  );
}
