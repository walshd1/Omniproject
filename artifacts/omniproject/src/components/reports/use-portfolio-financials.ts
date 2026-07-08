import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  useListProjects, useGetSettings, getGetProjectFinancialsQueryOptions,
  type Project, type ProjectFinancials, type Settings, type FxRates,
} from "@workspace/api-client-react";
import { useFxRates, resolveFxAsOf, currencyList, DEFAULT_CURRENCY } from "../../lib/currency";
import { consolidateFinancials, type ProjectFin, type FinanceRollup, type CurrencyMix } from "../../lib/portfolio-finance";

/**
 * Shared fan-out for the consolidated portfolio financials (Portfolio Financials report + Exec Board
 * Pack): fetch every project's financials (deduped via React Query with the other surface that reads
 * the same key), resolve the reporting currency (view override → org setting → FX base), and convert +
 * roll up each project into that one currency. One place so both surfaces assemble identically.
 *
 * The board pack overlays financials on portfolio health and shouldn't block on the finance fan-out, so
 * `projLoading` and `finLoading` are returned separately — each consumer decides what gates its view.
 */
export function usePortfolioFinancials(): {
  projects: Project[] | undefined;
  consolidated: { programmes: FinanceRollup[]; portfolio: FinanceRollup; currencyMix: CurrencyMix[] };
  target: string;
  setReporting: (currency: string) => void;
  options: string[];
  projLoading: boolean;
  finLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  settings: Settings | undefined;
  fx: FxRates | undefined;
} {
  const { data: projects, isLoading: projLoading, isError, error, refetch } = useListProjects();
  const { data: settings } = useGetSettings();
  const { data: fx } = useFxRates(resolveFxAsOf(settings));
  const [reporting, setReporting] = useState("");

  const ids = useMemo(() => (projects ?? []).map((p) => p.id), [projects]);
  // `combine` keeps the per-project financials array referentially stable across renders that don't
  // change the underlying query data, so `consolidated` below doesn't re-run consolidateFinancials over
  // the whole portfolio on every unrelated re-render. See docs/PERF-PATTERNS-REVIEW.md, Theme C.
  const financialsByProject = useQueries({
    queries: ids.map((id) => getGetProjectFinancialsQueryOptions(id)),
    combine: (results) => ({
      data: results.map((r) => r.data as ProjectFinancials | undefined),
      isLoading: results.some((r) => r.isLoading),
    }),
  });

  // View override → the org default reporting currency → the FX base.
  const target = reporting || settings?.reportingCurrency || fx?.base || DEFAULT_CURRENCY;

  const consolidated = useMemo(() => {
    const withFin: ProjectFin[] = (projects ?? [])
      .map((p, i) => ({ p, fin: financialsByProject.data[i] }))
      .filter((x): x is { p: typeof x.p; fin: ProjectFinancials } => !!x.fin)
      .map(({ p, fin }) => ({ projectId: p.id, projectName: p.name, programmeId: p.programmeId ?? null, programmeName: p.programmeName ?? null, fin }));
    return consolidateFinancials(withFin, target, fx?.rates);
  }, [projects, financialsByProject, target, fx]);

  return {
    projects,
    consolidated,
    target,
    setReporting,
    options: currencyList(fx?.rates),
    projLoading,
    finLoading: financialsByProject.isLoading,
    isError,
    error,
    refetch,
    settings,
    fx,
  };
}
