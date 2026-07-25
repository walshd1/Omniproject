import { depreciationSchedule, depreciationJournal, type DepreciationMethod, type JournalEntryPayload } from "@workspace/backend-catalogue";
import { depreciationAccounts, missingAccountingAccounts, type AccountingConfig } from "./accounting-policy";

/**
 * DEPRECIATION PERIOD-RUN PLANNER — pure. Given the fixed-asset register, the resolved accounting policy, and an
 * "as of" date, it decides exactly which depreciation journals are DUE and returns them ready to post, plus the
 * write-back each asset needs so a re-run is a no-op. No I/O — the effect that runs it does the broker reads/writes.
 *
 * IDEMPOTENCY is the whole point of a scheduled run: it must be safe to fire twice. The planner computes each
 * asset's CANONICAL from-inception schedule (fixed by cost/salvage/life/method — not by mutable accumulated), and
 * posts only the periods in `(depreciationThroughDate, asOf]`. After posting, the asset's `depreciationThroughDate`
 * advances to the last posted period, so the next run sees those periods as already done. `accumulatedDepreciation`
 * and `netBookValue` are OUTPUTS written back from the canonical cumulative, never inputs.
 */

/** The fixed-asset register subset a run reads (dirty field values tolerated). */
export interface RunAsset {
  /** Record id — the journal reference + the write-back target. */
  id: string;
  assetNumber?: string;
  acquisitionCost: number;
  salvageValue?: number;
  usefulLifeMonths: number;
  /** Absent ⇒ the org's default method applies. */
  depreciationMethod?: string;
  inServiceDate?: string;
  /** in_service | disposed | impaired | held_for_sale — only in_service depreciates. */
  assetStatus?: string;
  /** The period this asset has already been depreciated through (ISO). Absent ⇒ from inception. */
  depreciationThroughDate?: string;
}

/** One journal a run will post. */
export interface PlannedPosting {
  assetId: string;
  assetNumber?: string;
  period: string; // the period's posting date (ISO)
  amount: number;
  journal: JournalEntryPayload;
}

/** The write-back an asset needs after its postings land (advances the idempotency marker + carrying figures). */
export interface AssetWriteback {
  assetId: string;
  depreciationThroughDate: string;
  accumulatedDepreciation: number;
  netBookValue: number;
}

export interface AssetSkip { assetId: string; reason: string }

export interface DepreciationRunPlan {
  asOf: string;
  posts: PlannedPosting[];
  writebacks: AssetWriteback[];
  skipped: AssetSkip[];
  /** True when the org's depreciation GL accounts aren't set — nothing can post until they are. */
  blockedNoAccounts: boolean;
}

const DEPRECIABLE_STATUS = "in_service";

/** Plan the depreciation run: which journals are due as of `asOf`, and each asset's resulting write-back. Pure. */
export function planDepreciationRun(assets: readonly RunAsset[], accounting: AccountingConfig, asOf: string): DepreciationRunPlan {
  const plan: DepreciationRunPlan = { asOf, posts: [], writebacks: [], skipped: [], blockedNoAccounts: false };

  // A depreciation run posts Dr depreciation-expense / Cr accumulated-depreciation; without those two GL codes it
  // can't post anything. Fail the whole run clearly rather than silently skip every asset.
  const missing = missingAccountingAccounts(accounting);
  if (missing.includes("depreciationExpense") || missing.includes("accumulatedDepreciation")) {
    plan.blockedNoAccounts = true;
    for (const a of assets) plan.skipped.push({ assetId: a.id, reason: "depreciation GL accounts are not set (accounting policy)" });
    return plan;
  }

  const accounts = depreciationAccounts(accounting);
  const method = accounting.defaultDepreciationMethod;

  for (const a of assets) {
    if ((a.assetStatus ?? DEPRECIABLE_STATUS) !== DEPRECIABLE_STATUS) { plan.skipped.push({ assetId: a.id, reason: `not in service (${a.assetStatus})` }); continue; }
    if (!a.inServiceDate) { plan.skipped.push({ assetId: a.id, reason: "no in-service date" }); continue; }

    let schedule;
    try {
      // CANONICAL schedule from inception (opening accumulated = 0); the due slice is filtered below.
      schedule = depreciationSchedule(
        {
          acquisitionCost: a.acquisitionCost,
          ...(a.salvageValue !== undefined ? { salvageValue: a.salvageValue } : {}),
          usefulLifeMonths: a.usefulLifeMonths,
          depreciationMethod: (a.depreciationMethod as DepreciationMethod) || method,
          inServiceDate: a.inServiceDate,
        },
        { factor: accounting.decliningBalanceFactor },
      );
    } catch (e) {
      plan.skipped.push({ assetId: a.id, reason: e instanceof Error ? e.message : "cannot schedule" });
      continue;
    }

    const through = a.depreciationThroughDate ?? "";
    const due = schedule.filter((p) => p.periodDate <= asOf && p.periodDate > through);
    if (!due.length) { plan.skipped.push({ assetId: a.id, reason: "up to date" }); continue; }

    let posted = 0;
    let last = due[0]!;
    for (const period of due) {
      const journal = depreciationJournal(period, accounts, `Depreciation ${a.assetNumber ?? a.id} ${period.periodDate}`);
      if (!journal) continue; // a zero-amount period (fully salvage) posts nothing but still advances the marker
      plan.posts.push({ assetId: a.id, ...(a.assetNumber ? { assetNumber: a.assetNumber } : {}), period: period.periodDate, amount: period.depreciation, journal });
      posted++;
      last = period;
    }
    // Advance the marker to the last DUE period even if some were zero — so we don't re-scan them next run.
    last = due[due.length - 1]!;
    plan.writebacks.push({ assetId: a.id, depreciationThroughDate: last.periodDate, accumulatedDepreciation: last.accumulatedDepreciation, netBookValue: last.netBookValue });
    if (posted === 0) { plan.skipped.push({ assetId: a.id, reason: "no depreciable amount this period" }); }
  }

  return plan;
}
