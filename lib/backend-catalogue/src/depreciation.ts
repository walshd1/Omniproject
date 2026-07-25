/**
 * FIXED-ASSET DEPRECIATION ENGINE — the pure computation over the F20 `fixed_asset` register.
 *
 * The `fixed_asset` record type (F20) is a data register: cost, salvage, useful life, method, accumulated
 * depreciation, NBV. This module is the COMPUTATION the register earns — the period-by-period schedule and the
 * balanced GL journals that post it. It is a pure, dependency-light library (the same home + shape as the
 * consolidation / num engines): given an asset it returns numbers and journal payloads and performs NO I/O.
 * The actual posting rides the existing `create_journal_entry` action dispatch; disposal and period runs simply
 * hand the write path a balanced journal the `finance-journal-balanced` rule already accepts.
 *
 * Four methods, matching the `depreciationMethod` enum on the field vocabulary:
 *   · straight_line          — the depreciable base spread evenly over the life.
 *   · declining_balance      — double-declining rate on the reducing book value, switching to straight-line for
 *                              the remaining life once that yields more (so it converges exactly to salvage).
 *   · sum_of_years_digits    — an accelerated weighting: period k gets (n−k+1)/Σ of the base.
 *   · units_of_production    — usage-driven; needs a per-period usage series (no time-only schedule exists).
 *
 * ROUNDING: every period is rounded to cents ({@link round2}); the FINAL period trues up to the exact remaining
 * amount so the rounded periods always sum to the depreciable base with no drift, and NBV lands exactly on
 * salvage (or, for units-of-production, on cost − total recognised).
 */
import { numLoose, round2, clamp } from "./num";

/** The four supported depreciation methods (the `depreciationMethod` field enum). */
export type DepreciationMethod = "straight_line" | "declining_balance" | "units_of_production" | "sum_of_years_digits";

const METHODS: ReadonlySet<string> = new Set<DepreciationMethod>([
  "straight_line",
  "declining_balance",
  "units_of_production",
  "sum_of_years_digits",
]);

/** The subset of a `fixed_asset` record the engine reads. Field keys mirror the F20 vocabulary. */
export interface DepreciableAsset {
  /** Original cost basis. */
  acquisitionCost: number;
  /** Residual value at end of life (defaults to 0). Depreciation never takes NBV below this. */
  salvageValue?: number;
  /** Useful life in months — the number of depreciation periods (time methods). */
  usefulLifeMonths: number;
  /** Which method to apply. */
  depreciationMethod: DepreciationMethod;
  /** Date the asset entered service — period 1 posts one month after this. ISO `YYYY-MM-DD`. */
  inServiceDate: string;
  /** Depreciation already taken (for an asset onboarded mid-life). Defaults to 0. */
  accumulatedDepreciation?: number;
  /** Recognised impairment, subtracted from carrying value on disposal. Defaults to 0. */
  impairmentLoss?: number;
}

/** One period of a depreciation schedule. */
export interface DepreciationPeriod {
  /** 1-based period number. */
  index: number;
  /** Posting date for the period (ISO `YYYY-MM-DD`), `inServiceDate` advanced by `index` months. */
  periodDate: string;
  /** Depreciation expense recognised IN this period. */
  depreciation: number;
  /** Cumulative depreciation THROUGH this period. */
  accumulatedDepreciation: number;
  /** Net book value at the END of this period (cost − accumulated). */
  netBookValue: number;
}

/** Options for schedule generation. `units`/`totalUnits` are required for units_of_production. */
export interface DepreciationOptions {
  /** Units produced/consumed per period — REQUIRED (and defines the period count) for units_of_production. */
  units?: readonly number[];
  /** Total lifetime units the asset is expected to produce — REQUIRED for units_of_production. */
  totalUnits?: number;
  /** Declining-balance multiplier — 2 = double-declining (200%), 1.5 = 150% DB. Org accounting POLICY, so it is
   *  supplied by the caller (resolved from the org config), not baked in. Defaults to 2. Ignored by other methods. */
  factor?: number;
}

/** The default declining-balance multiplier (double-declining / 200%) when the caller supplies no org policy. */
export const DEFAULT_DECLINING_BALANCE_FACTOR = 2;

/** Thrown when an asset cannot be depreciated as asked (bad life, unknown method, missing usage data). */
export class DepreciationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepreciationError";
  }
}

// ── Date maths — advance an ISO date by whole months, UTC, clamping to the shortest month ────────────────────
/** `YYYY-MM-DD` + `months`, UTC. Jan 31 + 1mo → Feb 28/29 (clamped to the target month's last day). */
export function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new DepreciationError(`invalid inServiceDate "${iso}" (expected YYYY-MM-DD)`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const targetY = y + Math.floor(m / 12);
  const targetM = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), lastDay);
  const out = new Date(Date.UTC(targetY, targetM, day));
  return out.toISOString().slice(0, 10);
}

/** The depreciable base — cost minus salvage, never negative. */
export function depreciableBase(asset: DepreciableAsset): number {
  return Math.max(0, round2(numLoose(asset.acquisitionCost) - numLoose(asset.salvageValue)));
}

/** Assemble the schedule rows from a per-period amount list, tracking accumulated + NBV and true-ing up NBV. */
function toSchedule(asset: DepreciableAsset, amounts: number[]): DepreciationPeriod[] {
  const cost = numLoose(asset.acquisitionCost);
  const opening = numLoose(asset.accumulatedDepreciation);
  let accumulated = opening;
  return amounts.map((amount, i) => {
    accumulated = round2(accumulated + amount);
    return {
      index: i + 1,
      periodDate: addMonths(asset.inServiceDate, i + 1),
      depreciation: amount,
      accumulatedDepreciation: accumulated,
      netBookValue: round2(cost - accumulated),
    };
  });
}

/** Round every element to cents and force the LAST to absorb the residual so Σ === `total` exactly (no drift). */
function trueUp(amounts: number[], total: number): number[] {
  if (!amounts.length) return amounts;
  const rounded = amounts.map(round2);
  const head = rounded.slice(0, -1);
  const sumHead = head.reduce((s, n) => s + n, 0);
  return [...head, round2(total - sumHead)];
}

function straightLine(base: number, n: number): number[] {
  const per = base / n;
  return trueUp(Array.from({ length: n }, () => per), base);
}

function sumOfYearsDigits(base: number, n: number): number[] {
  const syd = (n * (n + 1)) / 2; // Σ 1..n
  const amounts = Array.from({ length: n }, (_, k) => (base * (n - k)) / syd); // period k+1 → weight n-k
  return trueUp(amounts, base);
}

function decliningBalance(asset: DepreciableAsset, n: number, factor: number): number[] {
  const cost = numLoose(asset.acquisitionCost);
  const salvage = numLoose(asset.salvageValue);
  const rate = factor / n; // declining-balance rate per period (life is in periods); factor 2 = double-declining
  const amounts: number[] = [];
  let book = cost - numLoose(asset.accumulatedDepreciation);
  for (let k = 0; k < n; k++) {
    const remaining = n - k;
    const depreciable = Math.max(0, book - salvage);
    // Straight-line on the remaining book value; switch to it once it beats DDB (guarantees convergence).
    const sl = depreciable / remaining;
    const ddb = book * rate;
    let amount = clamp(Math.max(ddb, sl), 0, depreciable);
    if (k === n - 1) amount = depreciable; // final period lands exactly on salvage
    amount = round2(amount);
    amounts.push(amount);
    book = round2(book - amount);
  }
  return amounts;
}

function unitsOfProduction(base: number, opts: DepreciationOptions): number[] {
  const units = opts.units;
  const total = numLoose(opts.totalUnits);
  if (!units || !units.length || total <= 0) {
    throw new DepreciationError("units_of_production requires opts.units (per-period) and a positive opts.totalUnits");
  }
  let recognised = 0;
  const amounts = units.map((u) => {
    const raw = (base * numLoose(u)) / total;
    // Never recognise past the base even if reported units overrun the estimate.
    const capped = clamp(raw, 0, round2(base - recognised));
    recognised = round2(recognised + capped);
    return capped;
  });
  return amounts.map(round2);
}

/**
 * The full period-by-period depreciation schedule for an asset. Pure. Throws {@link DepreciationError} on an
 * invalid life, an unknown method, or units_of_production without a usage series.
 */
export function depreciationSchedule(asset: DepreciableAsset, opts: DepreciationOptions = {}): DepreciationPeriod[] {
  const method = asset.depreciationMethod;
  if (!METHODS.has(method)) throw new DepreciationError(`unknown depreciationMethod "${method}"`);
  const base = depreciableBase(asset);

  if (method === "units_of_production") {
    return toSchedule(asset, unitsOfProduction(base, opts));
  }

  const n = Math.trunc(numLoose(asset.usefulLifeMonths));
  if (n <= 0) throw new DepreciationError(`usefulLifeMonths must be a positive integer (got ${asset.usefulLifeMonths})`);
  if (base <= 0) return toSchedule(asset, Array.from({ length: n }, () => 0)); // nothing to depreciate

  const factor = numLoose(opts.factor) > 0 ? numLoose(opts.factor) : DEFAULT_DECLINING_BALANCE_FACTOR;
  const amounts =
    method === "straight_line" ? straightLine(base, n)
    : method === "sum_of_years_digits" ? sumOfYearsDigits(base, n)
    : decliningBalance(asset, n, factor);
  return toSchedule(asset, amounts);
}

/** The depreciation expense for the single period whose posting date is `periodDate`, or 0 if none matches. */
export function depreciationForPeriod(asset: DepreciableAsset, periodDate: string, opts: DepreciationOptions = {}): number {
  const row = depreciationSchedule(asset, opts).find((p) => p.periodDate === periodDate);
  return row ? row.depreciation : 0;
}

// ── GL posting — balanced journals the existing write path (create_journal_entry) accepts ────────────────────

/** One journal line — `debit`/`credit` member names match what `finance-journal-balanced` / `journalTotals` read. */
export interface JournalLine {
  account: string;
  debit: number;
  credit: number;
  memo?: string;
}

/** A balanced journal-entry payload — the shape the `create_journal_entry` action + ruleset guard accept. */
export interface JournalEntryPayload {
  journalDate: string;
  lines: JournalLine[];
}

/** The GL accounts a depreciation run posts to. */
export interface DepreciationAccounts {
  /** Depreciation-expense account (debited). */
  expenseAccount: string;
  /** Accumulated-depreciation contra-asset account (credited). */
  accumulatedAccount: string;
}

/**
 * The balanced journal for ONE depreciation period: Dr depreciation expense, Cr accumulated depreciation.
 * Returns null for a zero-amount period (nothing to post).
 */
export function depreciationJournal(period: DepreciationPeriod, accounts: DepreciationAccounts, memo?: string): JournalEntryPayload | null {
  const amount = round2(numLoose(period.depreciation));
  if (amount <= 0) return null;
  const note = memo ?? `Depreciation period ${period.index}`;
  return {
    journalDate: period.periodDate,
    lines: [
      { account: accounts.expenseAccount, debit: amount, credit: 0, memo: note },
      { account: accounts.accumulatedAccount, debit: 0, credit: amount, memo: note },
    ],
  };
}

// ── Disposal — gain/loss + the retirement journal ────────────────────────────────────────────────────────────

/** The outcome of disposing of an asset. */
export interface DisposalResult {
  /** Carrying value at disposal: cost − accumulated depreciation − impairment. */
  netBookValue: number;
  /** Proceeds − carrying value: positive = gain, negative = loss. */
  gainLoss: number;
  isGain: boolean;
  isLoss: boolean;
}

/** An asset being disposed of — the register subset the disposal maths reads. */
export interface DisposableAsset {
  acquisitionCost: number;
  accumulatedDepreciation?: number;
  impairmentLoss?: number;
  disposalProceeds?: number;
  /** Disposal date — the retirement journal's posting date. ISO `YYYY-MM-DD`. */
  disposalDate?: string;
}

/** Carrying value + gain/loss on disposal. Pure. */
export function disposalResult(asset: DisposableAsset): DisposalResult {
  const cost = numLoose(asset.acquisitionCost);
  const accumulated = numLoose(asset.accumulatedDepreciation);
  const impairment = numLoose(asset.impairmentLoss);
  const proceeds = numLoose(asset.disposalProceeds);
  const netBookValue = round2(cost - accumulated - impairment);
  const gainLoss = round2(proceeds - netBookValue);
  return { netBookValue, gainLoss, isGain: gainLoss > 0, isLoss: gainLoss < 0 };
}

/** The GL accounts a disposal posts to. */
export interface DisposalAccounts {
  /** Fixed-asset cost account (credited to remove the asset). */
  assetAccount: string;
  /** Accumulated-depreciation account (debited to clear it). */
  accumulatedAccount: string;
  /** Cash/receivable account the proceeds land in (debited). */
  proceedsAccount: string;
  /** Gain-or-loss-on-disposal account (credited on a gain, debited on a loss). */
  gainLossAccount: string;
}

/**
 * The balanced retirement journal on disposal: clear the asset cost + its accumulated depreciation, book the
 * proceeds, and recognise the gain (credit) or loss (debit). Impairment is treated as part of the carrying
 * reduction. Every line rounds to cents and the entry balances by construction.
 */
export function disposalJournal(asset: DisposableAsset, accounts: DisposalAccounts, memo = "Asset disposal"): JournalEntryPayload {
  const cost = round2(numLoose(asset.acquisitionCost));
  const accumulated = round2(numLoose(asset.accumulatedDepreciation) + numLoose(asset.impairmentLoss));
  const proceeds = round2(numLoose(asset.disposalProceeds));
  const { gainLoss, isGain } = disposalResult(asset);
  const lines: JournalLine[] = [];
  if (proceeds > 0) lines.push({ account: accounts.proceedsAccount, debit: proceeds, credit: 0, memo });
  if (accumulated > 0) lines.push({ account: accounts.accumulatedAccount, debit: accumulated, credit: 0, memo });
  if (cost > 0) lines.push({ account: accounts.assetAccount, debit: 0, credit: cost, memo });
  const gl = Math.abs(gainLoss);
  if (gl > 0) {
    lines.push(
      isGain
        ? { account: accounts.gainLossAccount, debit: 0, credit: gl, memo: `${memo} — gain` }
        : { account: accounts.gainLossAccount, debit: gl, credit: 0, memo: `${memo} — loss` },
    );
  }
  return { journalDate: asset.disposalDate ?? "", lines };
}
