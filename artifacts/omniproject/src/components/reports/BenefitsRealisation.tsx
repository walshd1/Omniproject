import { ReportEmpty } from "./ReportEmpty";
import { useMemo } from "react";
import { type Issue } from "@workspace/api-client-react";
import { summariseBenefits, type BenefitBucket } from "../../lib/benefits";
import { useProjectIssuesMoney } from "../../lib/currency";
import { truncateLabel } from "../../lib/utils";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { ReportTable } from "./ReportTable";
import { ChartView } from "../charts/ChartView";

/**
 * Benefits Realisation report. STATELESS: it rolls up the canonical `benefit*` fields already on
 * the project's work items — planned vs actual value, realisation %, the risk-adjusted forecast,
 * and the RAG spread — and derives everything on the fly. Nothing is stored.
 */

const BUCKET_META: Record<BenefitBucket, { label: string; colour: string }> = {
  realised: { label: "Realised", colour: "#16a34a" },
  on_track: { label: "On track", colour: "#2563eb" },
  at_risk: { label: "At risk", colour: "#d97706" },
  missed: { label: "Missed", colour: "#dc2626" },
  not_started: { label: "Not started", colour: "#6b7280" },
};
const BUCKET_ORDER: BenefitBucket[] = ["realised", "on_track", "at_risk", "missed", "not_started"];

export function BenefitsRealisation({ projectId }: { projectId: string }) {
  const { issues, money, isLoading, isError, error, refetch } = useProjectIssuesMoney(projectId);

  const summary = useMemo(() => summariseBenefits((issues ?? []) as Issue[]), [issues]);

  const chartData = useMemo(
    () => summary.rows.slice(0, 8).map((r) => ({ name: truncateLabel(r.title), planned: r.planned, actual: r.actual })),
    [summary],
  );

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {summary.count === 0 ? (
        <ReportEmpty testId="benefits-empty">
          No benefits to report — add planned/actual benefit values (and a benefit status) to work items to track realisation.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="benefits">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Planned benefit" value={money(summary.totalPlanned)} />
            <StatCard label="Realised to date" value={money(summary.totalActual)} hint={`${Math.round(summary.realisation * 100)}% of plan`} />
            <StatCard label="Realisation" value={`${Math.round(summary.realisation * 100)}%`} />
            <StatCard label="Risk-adjusted forecast" value={money(summary.expectedValue)} hint="planned × confidence" />
          </div>

          {/* RAG status spread */}
          <div className="flex flex-wrap gap-2" data-testid="benefits-rag">
            {BUCKET_ORDER.filter((b) => summary.byStatus[b] > 0).map((b) => (
              <span key={b} className="inline-flex items-center gap-2 border border-border px-2.5 py-1 text-xs font-bold">
                <span className="inline-block w-2.5 h-2.5" style={{ background: BUCKET_META[b].colour }} aria-hidden="true" />
                {BUCKET_META[b].label}
                <span className="tabular-nums text-muted-foreground">{summary.byStatus[b]}</span>
              </span>
            ))}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Planned vs realised (top benefits)</div>
            <ChartView
              type="bar"
              height={Math.max(160, chartData.length * 34)}
              data={chartData}
              valueFormatter={money}
              palette={["#94a3b8", "#2563eb"]}
              series={[{ key: "planned", label: "Planned" }, { key: "actual", label: "Realised" }]}
            />
          </div>

          <ReportTable
            rows={summary.rows}
            rowKey={(r) => r.id}
            rowTestId={(r) => `benefit-row-${r.id}`}
            columns={[
              { header: "Benefit", cell: (r) => r.title, cellClassName: "font-mono truncate max-w-[16rem]" },
              { header: "Owner", cell: (r) => r.benefitOwner || "—", cellClassName: "text-muted-foreground" },
              { header: "Status", cell: (r) => (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2" style={{ background: BUCKET_META[r.bucket].colour }} aria-hidden="true" />
                  {BUCKET_META[r.bucket].label}
                </span>
              ) },
              { header: "Planned", align: "right", cell: (r) => money(r.planned) },
              { header: "Realised", align: "right", cell: (r) => money(r.actual) },
              { header: "%", align: "right", cell: (r) => `${Math.round(r.realisation * 100)}%` },
            ]}
          />

          <p className="text-[11px] text-muted-foreground">
            Planned vs realised benefit value across {summary.count} tracked benefit(s). The
            risk-adjusted forecast weights each planned benefit by its confidence — nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
