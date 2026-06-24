import { useState } from "react";
import { useGetProjectFinancials, type ProjectFinancials } from "@workspace/api-client-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { useT } from "../../lib/i18n";
import { useFxRates, convertAmount, currencyList } from "../../lib/currency";

const HEALTH: Record<string, string> = { GREEN: "text-green-500", AMBER: "text-amber-500", RED: "text-red-500" };

// The financials endpoint returns point-in-time EVM scalars. Derive an
// indicative cumulative trend (linear) so Actual Cost can be plotted against
// Earned Value across the timeline, with the budget baseline for reference.
function trend(f: ProjectFinancials) {
  const periods = 6;
  return Array.from({ length: periods }, (_, i) => {
    const t = (i + 1) / periods;
    return {
      period: `P${i + 1}`,
      "Planned (Budget)": Math.round((f.budgetAllocated / periods) * (i + 1)),
      "Actual Cost": Math.round(f.actualBurn * t),
      "Earned Value": Math.round(f.earnedValue * t),
    };
  });
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="border border-border bg-background p-3">
      <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">{label}</div>
      <div className={`text-lg font-black font-mono ${accent ?? ""}`}>{value}</div>
    </div>
  );
}

export function FinancialEvmChart({ projectId }: { projectId: string }) {
  const { data: f, isLoading } = useGetProjectFinancials(projectId);
  const { t, formatCurrency } = useT();
  const { data: fx } = useFxRates();
  const [display, setDisplay] = useState("");

  const native = f?.currency || "USD";
  const displayCcy = display || native;
  // Format in the active locale, converting the backend's native currency to the
  // chosen display currency (multi-currency portfolio comparison).
  const money = (n: number) => formatCurrency(convertAmount(n, native, displayCcy, fx?.rates), displayCcy);

  const currencyOptions = Array.from(new Set([native, ...currencyList(fx?.rates)]));

  // Financials require a cost/ERP source wired through n8n. Without
  // budgetAllocated there is nothing to chart — surface the dependency rather
  // than render misleading zeros.
  const unavailable = !!f && (f.budgetAllocated === undefined || f.budgetAllocated === null);

  return (
    <section>
      <div className="flex items-center justify-between mb-4 gap-3">
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">{t("reports.earnedValue")}</h2>
        {!unavailable && f && (
          <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
            {t("reports.displayCurrency")}
            <select
              value={displayCcy}
              onChange={(e) => setDisplay(e.target.value)}
              className="bg-background border border-border px-2 py-1 text-xs font-mono uppercase outline-none"
            >
              {currencyOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="bg-card border border-border p-6">
        {isLoading || !f ? (
          <div className="h-72 animate-pulse" />
        ) : unavailable ? (
          <div className="h-40 flex items-center justify-center text-center text-sm text-muted-foreground px-6">
            Financial data not available — requires a cost / ERP source (e.g. SAP, Dynamics, Dolibarr, Odoo) wired into the
            <span className="font-mono"> get_project_financials </span> n8n workflow.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Stat label="Budget (BAC)" value={money(f.budgetAllocated)} />
              <Stat label="Actual Burn (AC)" value={money(f.actualBurn)} />
              <Stat label="Forecast (EAC)" value={money(f.forecastCostAtCompletion)} accent={f.forecastCostAtCompletion > f.budgetAllocated ? "text-red-500" : "text-green-500"} />
              <Stat label="Health" value={f.financialHealth} accent={HEALTH[f.financialHealth]} />
            </div>
            <div className="grid grid-cols-2 gap-3 mb-6 max-w-xs">
              <Stat label="CPI" value={f.cpi.toFixed(2)} accent={f.cpi < 1 ? "text-red-500" : "text-green-500"} />
              <Stat label="SPI" value={f.spi.toFixed(2)} accent={f.spi < 1 ? "text-red-500" : "text-green-500"} />
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend(f)} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" />
                  <XAxis dataKey="period" stroke="currentColor" className="text-muted-foreground" fontSize={12} />
                  <YAxis stroke="currentColor" className="text-muted-foreground" fontSize={12} tickFormatter={(v) => money(v as number)} width={80} />
                  <Tooltip formatter={(v) => money(v as number)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                  <Legend />
                  <ReferenceLine y={f.budgetAllocated} stroke="#a1a1aa" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="Planned (Budget)" stroke="#a1a1aa" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="Actual Cost" stroke="#ef4444" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Earned Value" stroke="#22c55e" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-muted-foreground mt-3 font-mono">
              Cumulative trend derived from point-in-time EVM scalars (indicative). CPI = EV/AC, SPI = EV/PV.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
