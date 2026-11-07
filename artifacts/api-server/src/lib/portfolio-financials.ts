/**
 * Portfolio financials fan-out — the server-side half of the Portfolio Financials report. Fetches every
 * project's financials + the FX table through the broker and folds them into programme roll-ups + a
 * portfolio total in one reporting currency, using the SHARED `consolidateFinancials` (the same pure
 * implementation the SPA uses — @workspace/backend-catalogue). Serves `GET /api/portfolio/financials`,
 * so the report can be a DECLARATIVE definition bound to this endpoint rather than a bespoke renderer.
 *
 * Read-through and derive-only (zero-at-rest): nothing is stored. The per-project broker fan-out is
 * bounded (a 200-project portfolio is otherwise a 200-way thundering herd per request).
 */
import type { Request } from "express";
import { getBroker, contextFromReq, type Row, type Project } from "../broker";
import { getSettings } from "./settings";
import { getFxRates } from "./currency";
import { poolMap } from "./concurrency-pool";
import { alignToProjects } from "./portfolio-summary";
import { recordAttempted, recordUnavailable, availabilityReport } from "./read-availability";
import { resolveCapabilities } from "./capabilities";
import {
  consolidateByGroup, consolidationSpec, flattenRow, currencyMix, DEFAULT_CURRENCY,
  computeEvm, type ConsolidationInput, type EvmResult,
} from "@workspace/backend-catalogue";

/** Bound the per-project financials fan-out (see portfolio-summary.ts for the same rationale). */
const FANOUT_LIMIT = 10;

/** A consolidated financial row of this endpoint's wire contract (mirrors the OpenAPI FinanceRollup
 *  schema). The field names ARE the `financials` consolidation spec's measure/derived keys — the endpoint
 *  is where the generic roll-up is bound to this named shape. */
export interface FinanceRollup {
  key: string;
  label: string;
  projects: number;
  budget: number;
  actual: number;
  forecast: number;
  earnedValue: number;
  /** Planned value (PV / BCWS) — folded from the source financials; 0 when no backend supplies it. */
  plannedValue: number;
  variance: number;
  cpi: number | null;
  /** The full EVM picture (CPI/SPI/EAC/ETC/VAC/TCPI) for this roll-up, or null when there are no
   *  financials to compute from. SPI/schedule variance are null until a backend supplies plannedValue. */
  evm: EvmResult | null;
  localCurrency: string | null;
  local: { budget: number; actual: number; forecast: number; earnedValue: number } | null;
  excludedForFx: number;
}

/**
 * Derive the full EVM picture for one consolidated roll-up (pure; no I/O — unit-testable directly).
 * Maps the roll-up's folded measures to the four EVM primitives (BAC = budget, EV = earned value,
 * AC = actual, PV = planned value) and delegates to the shared `computeEvm`. Returns null when the
 * roll-up carries no financials at all (nothing to forecast), so a caller renders "—" rather than zeros.
 */
export function evmForRollup(r: Pick<FinanceRollup, "budget" | "actual" | "earnedValue" | "plannedValue">): EvmResult | null {
  if (r.budget === 0 && r.actual === 0 && r.earnedValue === 0 && r.plannedValue === 0) return null;
  return computeEvm({
    budgetAtCompletion: r.budget,
    earnedValue: r.earnedValue,
    actualCost: r.actual,
    plannedValue: r.plannedValue,
  });
}

/** The consolidated portfolio-financials payload `GET /api/portfolio/financials` returns. */
export interface PortfolioFinancials {
  /** The reporting currency every amount below is converted into. */
  reportingCurrency: string;
  /** Per-programme (+ "Standalone") roll-ups, worst-variance first. */
  programmes: FinanceRollup[];
  /** The whole-portfolio total. */
  portfolio: FinanceRollup;
  /** Distinct source currencies seen (for the "consolidated from N currencies" note). */
  currencyMix: Array<{ currency: string; projects: number }>;
  /** The FX table's provenance for the footnote, or null when no rates were available. */
  fx: { base: string; provenance: string | null; asOf: string | null } | null;
  /** Which sources answered while building this report. `complete: false` means a backend did not
   *  answer and these roll-ups cover only what did — the report must say "N of M sources reporting"
   *  rather than present the total as the portfolio's. Carried here (not just on /portfolio/summary)
   *  because THIS is the endpoint the Portfolio Financials report calls, so it is where a user would
   *  otherwise read a partial total as a complete one. See docs/DEGRADED-READS.md. */
  availability: ReturnType<typeof availabilityReport>;
}

/** The org's FX "as of" date, mirroring resolveFxAsOf in portfolio-summary.ts / the SPA currency lib. */
function resolveFxAsOf(settings: ReturnType<typeof getSettings>): string | undefined {
  if (settings.fxRatePolicy === "spot") return undefined;
  return settings.fxRateAsOfDate ?? undefined;
}

/** A user-supplied `?currency=` value is only accepted as a plausible code (else fall back to the org
 *  default). `convertAmount` is prototype-safe on the key regardless, but this keeps the value tidy. */
function sanitizeCurrency(raw: unknown): string | undefined {
  return typeof raw === "string" && /^[A-Za-z]{2,8}$/.test(raw) ? raw.toUpperCase() : undefined;
}

/**
 * Compute the consolidated portfolio financials for one reporting currency (a `?currency=` override, else
 * the org default → FX base → GBP). Best-effort: a project whose financials call fails is dropped from
 * the fold (never fails the whole report); no financials capability ⇒ an empty roll-up.
 */
export async function computePortfolioFinancials(req: Request, currencyRaw?: unknown): Promise<PortfolioFinancials> {
  const broker = getBroker();
  const ctx = contextFromReq(req);
  const settings = getSettings();
  const [caps, projects] = await Promise.all([
    resolveCapabilities(req).catch(() => null),
    broker.listProjects(ctx).catch(() => [] as Project[]),
  ]);

  const fx = await getFxRates(req, resolveFxAsOf(settings)).catch(() => null);
  const target = sanitizeCurrency(currencyRaw) || settings.reportingCurrency || fx?.base || DEFAULT_CURRENCY;

  const financialsOff = !!caps && !caps.financials;
  // Prefer the broker's BULK read when it has one: this is the endpoint the Portfolio Financials
  // report actually calls, so it is where a user feels the O(projects) fan-out. Same trade as
  // lib/portfolio-summary.ts — one call instead of one per project — with the fan-out kept as the
  // fallback for adapters that don't implement it. `alignToProjects` maps rows onto the VISIBLE
  // project list, which is also what keeps an out-of-scope row from reaching the consolidation.
  const rows: Array<Row | null> = financialsOff || !projects.length
    ? []
    : broker.portfolioFinancials
      ? await broker.portfolioFinancials(ctx).then(
          (all) => alignToProjects(all, projects),
          () => projects.map(() => null),
        )
      : await poolMap(projects, FANOUT_LIMIT, (p) => broker.projectFinancials(ctx, p.id).catch(() => null));

  // Attribute the gaps: a project whose financials never arrived is a missing source, and the report
  // needs to say so rather than quietly consolidating a smaller portfolio into a confident total.
  recordAttempted(projects.length);
  const missing: string[] = [];
  for (const [i, r] of rows.entries()) {
    if (r === null) {
      recordUnavailable(`project:${projects[i]!.id}`, "financials read failed");
      missing.push(projects[i]!.id);
    }
  }
  // The RAW ids belong here, in the logs, where an operator diagnosing this is looking. The response
  // keeps them too (for support), but the UI shows a plain sentence instead — a reader cannot place a
  // project id, and twenty of them bury the fact that some cost data is simply missing.
  if (missing.length) {
    req.log.warn(
      { projects: projects.length, missing: missing.length, missingProjectIds: missing.slice(0, 50) },
      "portfolio financials incomplete — some projects' financials did not load",
    );
  }

  // Bind each project's financials to the generic consolidation engine, grouped by programme. The
  // `financials` spec (data) says which fields to fold and derive; `flattenRow` hoists the resulting
  // metrics to this endpoint's named wire shape. No finance-specific fold code lives here.
  const inputs: ConsolidationInput[] = projects
    .map((p, i) => ({ p, fin: rows[i] as Row | null | undefined }))
    .filter((x): x is { p: Project; fin: Row } => !!x.fin)
    .map(({ p, fin }) => ({
      groupKey: (p.programmeId ?? "__standalone__") as string,
      groupLabel: p.programmeId ? String(((p as Row)["programmeName"] as string | null) ?? p.programmeId) : "Standalone",
      currency: String(fin["currency"] ?? ""),
      items: [fin],
    }));

  const { groups, total } = consolidateByGroup(inputs, consolidationSpec("financials"), target, fx?.rates);
  // Hoist each consolidated row to the named wire shape, then attach the computed EVM picture. The
  // fold (data) produces the primitives; the shared evm.ts engine (below the seam) derives the indices —
  // no EVM formula lives in this route.
  const withEvm = (row: ReturnType<typeof flattenRow>): FinanceRollup => {
    const r = row as unknown as FinanceRollup;
    return { ...r, evm: evmForRollup(r) };
  };
  return {
    availability: availabilityReport(),
    reportingCurrency: target,
    programmes: groups.map(flattenRow).map(withEvm),
    portfolio: withEvm(flattenRow(total)),
    currencyMix: currencyMix(inputs.map((i) => i.currency)),
    fx: fx ? { base: fx.base, provenance: fx.provenance, asOf: fx.asOf } : null,
  };
}
