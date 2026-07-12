import { ReportEmpty } from "./ReportEmpty";
import { useMemo } from "react";
import { convertAmount } from "../../lib/currency";
import { num } from "../../lib/num";
import { useT } from "../../lib/i18n";
import type { ProjectItems } from "../../lib/portfolio-value";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { usePortfolioItems } from "./use-portfolio-items";
import { StrategyCascade } from "./StrategyCascade";
import { Badge } from "../tiles/Badge";
import type { CascadeItem } from "../../lib/strategy-cascade";

/**
 * Strategy Alignment (Strategy-to-execution / OKR alignment) — groups every work item by its strategic
 * theme (or, when a backend doesn't set one, its first strategic goal), and rolls up per theme the average
 * strategic contribution, planned vs realised benefit value, and a RAG health spread. Answers "which
 * strategic objectives / themes is the portfolio investing in, and how are they tracking (RAG / benefit
 * realisation)?". STATELESS: derived live from the work items + the FX table already loaded for the
 * portfolio; nothing is stored.
 */

/** The strategy-plane fields a work item may carry. Read via the canonical field registry (fields.json):
 *  strategicContribution/strategicGoals are on the typed read-model; strategicTheme/objectives/kpis are
 *  registry fields a backend passes through, so they're read defensively as optionals. */
export interface StrategyItem {
  strategicTheme?: string | null;
  strategicGoals?: string[] | null;
  objectives?: string[] | null;
  kpis?: string[] | null;
  strategicContribution?: number | null;
  healthStatus?: string | null;
  benefitStatus?: string | null;
  plannedBenefitValue?: number | null;
  actualBenefitValue?: number | null;
}

export type Rag = "green" | "amber" | "red" | "none";

/** Normalise a free-form health / benefit status into a RAG bucket (backend vocabulary preserved). */
export function ragBucket(status?: string | null): Rag {
  const s = (status ?? "").toLowerCase().trim();
  if (!s) return "none";
  if (/green|on.?track|on.?plan|healthy|realis|realiz|complete|achiev|deliver|good/.test(s)) return "green";
  if (/red|off.?track|miss|fail|lost|critical|blocked|cancel/.test(s)) return "red";
  if (/amber|at.?risk|yellow|warn|delay|slip|risk/.test(s)) return "amber";
  return "none";
}

export interface StrategyThemeRow {
  key: string;
  label: string;
  items: number;
  /** Mean strategic contribution (0–100) across the items that report it, or null when none do. */
  contribution: number | null;
  planned: number;
  actual: number;
  /** actual ÷ planned × 100 (0 when nothing planned). */
  realisation: number;
  rag: { green: number; amber: number; red: number };
  objectives: string[];
  kpis: string[];
}

export interface StrategyRollup {
  themes: StrategyThemeRow[];
  totals: { themes: number; items: number; planned: number; actual: number; realisation: number };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "theme";

/** Which theme an item belongs to: its explicit strategicTheme, else its first strategic goal, else
 *  "Unaligned" when it still carries a strategic/benefit signal — items with none are skipped as noise. */
function themeOf(i: StrategyItem): { key: string; label: string } | null {
  const t = i.strategicTheme?.trim();
  if (t) return { key: slug(t), label: t };
  const firstGoal = (i.strategicGoals ?? []).map((g) => g?.trim()).find((g): g is string => !!g);
  if (firstGoal) return { key: slug(firstGoal), label: firstGoal };
  if (i.strategicContribution != null || num(i.plannedBenefitValue) > 0 || num(i.actualBenefitValue) > 0) {
    return { key: "unaligned", label: "Unaligned" };
  }
  return null;
}

interface Working extends Omit<StrategyThemeRow, "contribution"> {
  _contribSum: number;
  _contribN: number;
}

function blank(theme: { key: string; label: string }): Working {
  return { key: theme.key, label: theme.label, items: 0, planned: 0, actual: 0, realisation: 0, rag: { green: 0, amber: 0, red: 0 }, objectives: [], kpis: [], _contribSum: 0, _contribN: 0 };
}

function addLabels(into: string[], from: (string | null | undefined)[] | null | undefined): void {
  for (const v of from ?? []) {
    const s = v?.trim();
    if (s && !into.includes(s)) into.push(s);
  }
}

/** Consolidate every project's work items into per-theme strategy rows + a portfolio total, in
 *  `reportingCurrency`. Pure and derive-only: the same items always produce the same roll-up. */
export function rollupStrategyThemes(projects: ProjectItems[], reportingCurrency: string, rates?: Record<string, number>): StrategyRollup {
  const map = new Map<string, Working>();
  for (const p of projects) {
    const conv = (n: number) => convertAmount(n, p.currency, reportingCurrency, rates);
    for (const it of p.items as unknown as StrategyItem[]) {
      const theme = themeOf(it);
      if (!theme) continue;
      const w = map.get(theme.key) ?? blank(theme);
      w.items += 1;
      w.planned += conv(num(it.plannedBenefitValue));
      w.actual += conv(num(it.actualBenefitValue));
      if (it.strategicContribution != null && Number.isFinite(it.strategicContribution)) {
        w._contribSum += Math.min(100, Math.max(0, it.strategicContribution));
        w._contribN += 1;
      }
      const rag = ragBucket(it.healthStatus ?? it.benefitStatus);
      if (rag !== "none") w.rag[rag] += 1;
      addLabels(w.objectives, it.objectives);
      addLabels(w.kpis, it.kpis);
      map.set(theme.key, w);
    }
  }
  const themes: StrategyThemeRow[] = [...map.values()]
    .map((w) => ({
      key: w.key,
      label: w.label,
      items: w.items,
      contribution: w._contribN > 0 ? Math.round(w._contribSum / w._contribN) : null,
      planned: round2(w.planned),
      actual: round2(w.actual),
      realisation: w.planned > 0 ? Math.round((w.actual / w.planned) * 1000) / 10 : 0,
      rag: w.rag,
      objectives: w.objectives,
      kpis: w.kpis,
    }))
    // Biggest strategic investment first, so the themes the portfolio is betting most on lead the table.
    .sort((a, b) => b.planned - a.planned || b.items - a.items || a.key.localeCompare(b.key));

  const planned = round2(themes.reduce((s, t) => s + t.planned, 0));
  const actual = round2(themes.reduce((s, t) => s + t.actual, 0));
  const items = themes.reduce((s, t) => s + t.items, 0);
  return { themes, totals: { themes: themes.length, items, planned, actual, realisation: planned > 0 ? Math.round((actual / planned) * 1000) / 10 : 0 } };
}

/** Dominant RAG for a theme (most-severe non-zero wins the tone), used to colour the realisation cell. */
function themeTone(rag: { green: number; amber: number; red: number }): string {
  if (rag.red > 0) return "text-red-500";
  if (rag.amber > 0) return "text-amber-500";
  if (rag.green > 0) return "text-green-600";
  return "text-muted-foreground";
}

function RagChips({ rag }: { rag: { green: number; amber: number; red: number } }) {
  const parts: { k: "green" | "amber" | "red"; n: number; tone: "good" | "warn" | "bad" }[] = [
    { k: "green", n: rag.green, tone: "good" },
    { k: "amber", n: rag.amber, tone: "warn" },
    { k: "red", n: rag.red, tone: "bad" },
  ];
  const any = rag.green + rag.amber + rag.red > 0;
  if (!any) return <span className="text-[11px] text-muted-foreground">—</span>;
  return (
    <span className="inline-flex gap-1">
      {parts.filter((p) => p.n > 0).map((p) => (
        <Badge key={p.k} tone={p.tone} testId={`rag-${p.k}`} className="tabular-nums">{p.n}</Badge>
      ))}
    </span>
  );
}

export function StrategyAlignment() {
  const { formatCurrency } = useT();
  const { projects, loading, isError, error, refetch, target, rates } = usePortfolioItems();
  const { themes, totals } = useMemo(() => rollupStrategyThemes(projects, target, rates), [projects, target, rates]);
  const money = (n: number) => formatCurrency(n, target);

  // Each project is one strategic INITIATIVE: aggregate its items' theme/objectives/kpis/contribution
  // and delivery progress, then the OKR cascade builds the theme→objective→initiative tree. Only
  // strategic projects (theme, objective, or a contribution signal) join — non-strategic ones aren't
  // "unaligned", they're just out of scope.
  const cascadeItems = useMemo<CascadeItem[]>(() => {
    const dedupe = (xs: (string | null | undefined)[]) => [...new Set(xs.map((s) => (s ?? "").trim()).filter(Boolean))];
    return projects
      .map((p): CascadeItem => {
        const items = p.items as unknown as StrategyItem[];
        const contribs = items.map((i) => i.strategicContribution).filter((n): n is number => typeof n === "number" && Number.isFinite(n));
        const progressReads = items
          .map((i) => (i as { percentWorkComplete?: number | null; completionPct?: number | null }))
          .map((i) => (typeof i.percentWorkComplete === "number" ? i.percentWorkComplete : typeof i.completionPct === "number" ? i.completionPct : null))
          .filter((n): n is number => n != null);
        return {
          id: p.projectId,
          name: p.projectName,
          strategicTheme: dedupe(items.map((i) => i.strategicTheme))[0] ?? null,
          objectives: dedupe(items.flatMap((i) => i.objectives ?? [])),
          kpis: dedupe(items.flatMap((i) => i.kpis ?? [])),
          strategicContribution: contribs.length ? Math.round(contribs.reduce((a, b) => a + b, 0) / contribs.length) : null,
          progressPct: progressReads.length ? Math.round(progressReads.reduce((a, b) => a + b, 0) / progressReads.length) : 0,
        };
      })
      .filter((ci) => (ci.objectives?.length ?? 0) > 0 || !!ci.strategicTheme || ci.strategicContribution != null);
  }, [projects]);

  return (
    <DataState isLoading={loading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {themes.length === 0 ? (
        <ReportEmpty testId="strategy-alignment-empty">
          No strategic data — set a strategic theme / goal, objectives, KPIs, contribution or benefit values on work items to see how the portfolio maps to strategy.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="strategy-alignment">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Strategic themes" value={String(totals.themes)} hint={`${totals.items} aligned item(s)`} />
            <StatCard label="Planned benefit" value={money(totals.planned)} hint="across all themes" />
            <StatCard label="Realised" value={money(totals.actual)} hint={`${totals.realisation}% realised`} />
            <StatCard label="Realisation" value={`${totals.realisation}%`} hint={totals.realisation >= 100 ? "target met" : "value outstanding"} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-bold">Strategic theme</th>
                  <th className="py-1.5 px-2 font-bold text-right">Items</th>
                  <th className="py-1.5 px-2 font-bold text-right">Contribution</th>
                  <th className="py-1.5 px-2 font-bold text-right">Planned</th>
                  <th className="py-1.5 px-2 font-bold text-right">Realised</th>
                  <th className="py-1.5 px-2 font-bold text-right">Realisation</th>
                  <th className="py-1.5 px-2 font-bold">Health (RAG)</th>
                </tr>
              </thead>
              <tbody>
                {themes.map((t) => (
                  <tr key={t.key} className="border-b border-border/50 align-top" data-testid={`strategy-alignment-row-${t.key}`}>
                    <td className="py-2 pr-3 font-bold">
                      {t.label}
                      {(t.objectives.length > 0 || t.kpis.length > 0) && (
                        <div className="text-[10px] font-normal text-muted-foreground" data-testid={`strategy-alignment-row-${t.key}-okr`}>
                          {t.objectives.length > 0 && <span>OKRs: {t.objectives.join(", ")}</span>}
                          {t.objectives.length > 0 && t.kpis.length > 0 && <span> · </span>}
                          {t.kpis.length > 0 && <span>KPIs: {t.kpis.join(", ")}</span>}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{t.items}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{t.contribution == null ? "—" : `${t.contribution}%`}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{money(t.planned)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{money(t.actual)}</td>
                    <td className={`py-2 px-2 text-right tabular-nums font-black ${themeTone(t.rag)}`}>{t.realisation}%</td>
                    <td className="py-2 px-2"><RagChips rag={t.rag} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Work items grouped by strategic theme (or their first strategic goal), consolidated into {target} and ordered by planned
            benefit (biggest strategic investment first). Contribution is the mean strategic contribution of the items that report it;
            RAG rolls up each item&apos;s delivery health (falling back to benefit status). Derived live; nothing is stored.
          </p>
          <StrategyCascade items={cascadeItems} />
        </div>
      )}
    </DataState>
  );
}
