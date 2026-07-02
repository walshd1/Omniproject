import { useGetProjectFinancials, useGetCapabilities, getGetProjectFinancialsQueryKey } from "@workspace/api-client-react";
import { useT } from "../lib/i18n";
import { useDisplayCurrency } from "../lib/currency";
import { RAG_TEXT as HEALTH } from "../lib/methodology";

function Stat({ label, value, accent }: { label: string; value: string; accent?: string | undefined }) {
  return (
    <div className="px-3 py-2 border-l border-border first:border-l-0">
      <div className="text-[10px] text-muted-foreground uppercase tracking-widest">{label}</div>
      <div className={`text-sm font-black font-mono ${accent ?? ""}`}>{value}</div>
    </div>
  );
}

/**
 * A slim project-level financial summary (Budget / Actual / Forecast / Health /
 * CPI / SPI) for the project page — the same EVM figures as the Reports chart,
 * surfaced where the work lives. Capability-gated and self-hiding: renders
 * nothing when the backend has no finance source or returns no budget.
 */
export function ProjectFinancialsStrip({ projectId }: { projectId: string }) {
  const { data: caps } = useGetCapabilities();
  const enabled = caps?.financials !== false;
  const { data: f } = useGetProjectFinancials(projectId, {
    query: { enabled, retry: false, queryKey: getGetProjectFinancialsQueryKey(projectId) },
  });
  const { formatCurrency } = useT();
  const native = f?.currency || "GBP";
  const { displayCcy, setDisplay, convert, currencyOptions } = useDisplayCurrency(native);

  if (caps?.financials === false) return null;
  if (!f || f.budgetAllocated == null) return null; // no finance source → hide

  const money = (n: number) => formatCurrency(convert(n), displayCcy);

  return (
    <div data-testid="project-financials" className="mb-6 border border-border bg-card">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Financials</span>
        <select
          value={displayCcy}
          onChange={(e) => setDisplay(e.target.value)}
          aria-label="Display currency"
          className="bg-background border border-border px-1.5 py-0.5 text-[11px] font-mono uppercase outline-none"
        >
          {currencyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap">
        <Stat label="Budget" value={money(f.budgetAllocated)} />
        <Stat label="Actual" value={money(f.actualBurn)} />
        <Stat label="Forecast" value={money(f.forecastCostAtCompletion)} accent={f.forecastCostAtCompletion > f.budgetAllocated ? "text-red-500" : "text-green-500"} />
        <Stat label="CPI" value={f.cpi.toFixed(2)} accent={f.cpi < 1 ? "text-red-500" : "text-green-500"} />
        <Stat label="SPI" value={f.spi.toFixed(2)} accent={f.spi < 1 ? "text-red-500" : "text-green-500"} />
        <Stat label="Health" value={f.financialHealth} accent={HEALTH[f.financialHealth]} />
      </div>
    </div>
  );
}
