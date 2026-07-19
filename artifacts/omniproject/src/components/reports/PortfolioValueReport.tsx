import { useMemo, type ReactNode } from "react";
import { ReportEmpty } from "./ReportEmpty";
import { useT } from "../../lib/i18n";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { ReportTable, type ReportColumn } from "./ReportTable";
import { usePortfolioItems } from "./use-portfolio-items";
import type { ProjectItems } from "../../lib/portfolio-value";

/**
 * Shared shell for the portfolio VALUE roll-up reports (Income, Benefits — and any future "consolidate a
 * per-project figure into one reporting currency, group by programme" report). They were byte-for-byte
 * twins apart from the roll-up function, the four headline cards, the metric columns and the footnote
 * wording; this captures the identical scaffold — data fetch, empty/loaded switch, the 4-up StatCard grid,
 * the Programme (+ local-currency sub-line) and Projects columns, and the FX-provenance footnote sentence —
 * and each report supplies only what actually differs. STATELESS/pure: it renders what the roll-up derives.
 */

/** The fields every portfolio value roll-up row shares (income + benefits). */
export interface PortfolioValueRow {
  key: string;
  label: string;
  projects: number;
  /** The single local currency shared by every project in the row, or null once it mixes ≥2. */
  localCurrency: string | null;
  /** Projects dropped from the consolidated total for want of an FX rate to the reporting currency. */
  excludedForFx: number;
}

/** One headline stat card in the 4-up grid above the table. */
export interface PortfolioValueStat {
  label: string;
  value: string;
  hint?: string;
}

export interface PortfolioValueReportProps<R extends PortfolioValueRow, P extends { excludedForFx: number }> {
  /** testid stem: container `${testId}`, empty state `${testId}-empty`, each row `${testId}-row-${key}`
   *  and its single-currency sub-line `${testId}-row-${key}-local`. */
  testId: string;
  /** Consolidate the fetched projects into `{ programmes, portfolio }` (e.g. rollupIncome / rollupBenefits). */
  rollup: (projects: ProjectItems[], target: string, rates?: Record<string, number>) => { programmes: R[]; portfolio: P };
  /** True when the portfolio total has nothing worth showing (renders the empty state). */
  isEmpty: (portfolio: P) => boolean;
  /** Empty-state guidance line. */
  emptyHint: ReactNode;
  /** The four headline cards, given the portfolio total and the reporting-currency formatter. */
  stats: (portfolio: P, money: (n: number) => string) => PortfolioValueStat[];
  /** Optional single-currency sub-line under a programme's name: the local amount + its noun (e.g. "planned").
   *  Rendered only while the row hasn't mixed currencies. */
  localLine?: (row: R) => { amount: number; noun: string } | null;
  /** The metric columns AFTER the shared Programme + Projects columns, given the currency formatter. */
  columns: (money: (n: number) => string) => ReportColumn<R>[];
  /** Footnote clauses either side of the shared FX-provenance sentence, given the reporting currency. */
  footnote: (target: string) => { lead: ReactNode; mid: ReactNode };
}

export function PortfolioValueReport<R extends PortfolioValueRow, P extends { excludedForFx: number }>({
  testId, rollup, isEmpty, emptyHint, stats, localLine, columns, footnote,
}: PortfolioValueReportProps<R, P>) {
  const { formatCurrency } = useT();
  const { projects, loading, isError, error, refetch, target, rates, fx } = usePortfolioItems();
  const { programmes, portfolio } = useMemo(() => rollup(projects, target, rates), [rollup, projects, target, rates]);
  const money = (n: number) => formatCurrency(n, target);
  const note = footnote(target);

  const programmeColumn: ReportColumn<R> = {
    header: "Programme",
    cellClassName: "font-bold",
    // A row still in its own single currency shows that local figure alongside the consolidated total —
    // dropped once the row mixes ≥2 currencies (only the consolidated total applies then).
    cell: (r) => {
      const loc = localLine?.(r);
      const showLocal = !!r.localCurrency && r.localCurrency !== target && !!loc;
      return (
        <>
          {r.label}
          {showLocal && loc && (
            <div className="text-[10px] font-normal text-muted-foreground" data-testid={`${testId}-row-${r.key}-local`}>
              {formatCurrency(loc.amount, r.localCurrency!)} local {loc.noun}
            </div>
          )}
        </>
      );
    },
  };
  const projectsColumn: ReportColumn<R> = { header: "Projects", align: "right", cell: (r) => r.projects, cellClassName: "text-muted-foreground" };

  return (
    <DataState isLoading={loading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {isEmpty(portfolio) ? (
        <ReportEmpty testId={`${testId}-empty`}>{emptyHint}</ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid={testId}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {stats(portfolio, money).map((s) => (
              <StatCard key={s.label} label={s.label} value={s.value} {...(s.hint ? { hint: s.hint } : {})} />
            ))}
          </div>
          <ReportTable
            rows={programmes}
            rowKey={(r) => r.key}
            rowTestId={(r) => `${testId}-row-${r.key}`}
            size="comfortable"
            columns={[programmeColumn, projectsColumn, ...columns(money)]}
          />
          <p className="text-[11px] text-muted-foreground">
            {note.lead}
            {fx?.provenance ? ` FX ${fx.provenance}${fx.asOf ? ` as of ${new Date(fx.asOf).toLocaleDateString("en-GB", { timeZone: "UTC" })}` : ""}.` : ""} {note.mid}
            {portfolio.excludedForFx > 0 ? ` ${portfolio.excludedForFx} project(s) with no FX rate to ${target} are excluded from the consolidated totals.` : ""}
            {" "}Derived live; nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
