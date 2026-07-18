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
import { createConcurrencyLimiter } from "./concurrency-pool";
import { resolveCapabilities } from "./capabilities";
import {
  consolidateFinancials, DEFAULT_CURRENCY,
  type ProjectFin, type FinanceRollup, type CurrencyMix,
} from "@workspace/backend-catalogue";

/** Bound the per-project financials fan-out (see portfolio-summary.ts for the same rationale). */
const FANOUT_LIMIT = 10;

/** The consolidated portfolio-financials payload `GET /api/portfolio/financials` returns. */
export interface PortfolioFinancials {
  /** The reporting currency every amount below is converted into. */
  reportingCurrency: string;
  /** Per-programme (+ "Standalone") roll-ups, worst-variance first. */
  programmes: FinanceRollup[];
  /** The whole-portfolio total. */
  portfolio: FinanceRollup;
  /** Distinct source currencies seen (for the "consolidated from N currencies" note). */
  currencyMix: CurrencyMix[];
  /** The FX table's provenance for the footnote, or null when no rates were available. */
  fx: { base: string; provenance: string | null; asOf: string | null } | null;
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
  const run = createConcurrencyLimiter(FANOUT_LIMIT);
  const rows = financialsOff || !projects.length
    ? []
    : await Promise.all(projects.map((p) => run(() => broker.projectFinancials(ctx, p.id).catch(() => null))));

  const fins: ProjectFin[] = projects
    .map((p, i) => ({ p, fin: rows[i] as Row | null | undefined }))
    .filter((x): x is { p: Project; fin: Row } => !!x.fin)
    .map(({ p, fin }) => ({
      projectId: p.id,
      projectName: String((p as Row)["name"] ?? p.id),
      programmeId: (p.programmeId ?? null) as string | null,
      programmeName: ((p as Row)["programmeName"] as string | null | undefined) ?? null,
      fin: {
        currency: String(fin["currency"] ?? ""),
        budgetAllocated: fin["budgetAllocated"],
        actualBurn: fin["actualBurn"],
        forecastCostAtCompletion: fin["forecastCostAtCompletion"],
        earnedValue: fin["earnedValue"],
      },
    }));

  const { programmes, portfolio, currencyMix } = consolidateFinancials(fins, target, fx?.rates);
  return {
    reportingCurrency: target,
    programmes,
    portfolio,
    currencyMix,
    fx: fx ? { base: fx.base, provenance: fx.provenance, asOf: fx.asOf } : null,
  };
}
