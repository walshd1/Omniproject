import { planDepreciationRun, type RunAsset } from "./depreciation-run";
import { type AccountingConfig } from "./accounting-policy";
import { numLoose } from "@workspace/backend-catalogue";

/**
 * The DEPRECIATION POSTING effect — the I/O side the automation engine's `finance.runDepreciation` action runs.
 * It reads the fixed-asset register, plans the due journals (pure {@link planDepreciationRun}), posts each through
 * the broker command edge, and writes each asset's advanced idempotency marker back. The broker command is
 * INJECTED (`BrokerCommandFn`) so this is unit-testable and so the real caller passes the autonomous-guarded
 * `brokerCommand` (every write is grant-gated, default-deny — the org must grant `create_journal_entry` /
 * `update_fixed_asset` to the rule actor). Reading `list_fixed_assets` is a non-write and always allowed.
 */

/** A broker command call — `(action, payload) => result`. The real one is `brokerCommand(ctx, action, payload, source)` curried. */
export type BrokerCommandFn = (action: string, payload: Record<string, unknown>) => Promise<unknown>;

export interface DepreciationPostResult {
  asOf: string;
  posted: number;
  postedPeriods: string[];
  updated: number;
  skipped: number;
  blockedNoAccounts: boolean;
}

/** Pull the record array out of whatever shape the backend's list command returns (array | {rows} | {data} | {items}). */
function recordsOf(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  const o = (raw ?? {}) as Record<string, unknown>;
  for (const k of ["rows", "data", "items", "fixed_assets", "results"]) {
    if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
  }
  return [];
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Coerce a raw fixed_asset record into the planner's {@link RunAsset} (dirty values tolerated). */
function toRunAsset(r: Record<string, unknown>): RunAsset | null {
  const id = str(r["id"]) ?? str(r["assetNumber"]);
  if (!id) return null;
  return {
    id,
    ...(str(r["assetNumber"]) ? { assetNumber: str(r["assetNumber"])! } : {}),
    acquisitionCost: numLoose(r["acquisitionCost"]),
    ...(r["salvageValue"] !== undefined ? { salvageValue: numLoose(r["salvageValue"]) } : {}),
    usefulLifeMonths: numLoose(r["usefulLifeMonths"]),
    ...(str(r["depreciationMethod"]) ? { depreciationMethod: str(r["depreciationMethod"])! } : {}),
    ...(str(r["inServiceDate"]) ? { inServiceDate: str(r["inServiceDate"])! } : {}),
    ...(str(r["assetStatus"]) ? { assetStatus: str(r["assetStatus"])! } : {}),
    ...(str(r["depreciationThroughDate"]) ? { depreciationThroughDate: str(r["depreciationThroughDate"])! } : {}),
  };
}

/**
 * Run the depreciation posting for `asOf` (default today, UTC). Reads assets, posts the due journals, advances
 * each asset's marker. Idempotent by construction — a re-run finds the marker advanced and posts nothing.
 */
export async function runDepreciationPosting(command: BrokerCommandFn, accounting: AccountingConfig, asOf: string): Promise<DepreciationPostResult> {
  const raw = await command("list_fixed_assets", {});
  const assets = recordsOf(raw).map(toRunAsset).filter((a): a is RunAsset => a !== null);
  const plan = planDepreciationRun(assets, accounting, asOf);

  // Post each due journal (Dr expense / Cr accumulated) through the grant-gated command edge.
  for (const post of plan.posts) {
    await command("create_journal_entry", post.journal as unknown as Record<string, unknown>);
  }
  // Advance each asset's idempotency marker + carrying figures so the next run is a no-op.
  for (const wb of plan.writebacks) {
    await command("update_fixed_asset", { id: wb.assetId, depreciationThroughDate: wb.depreciationThroughDate, accumulatedDepreciation: wb.accumulatedDepreciation, netBookValue: wb.netBookValue });
  }
  return {
    asOf,
    posted: plan.posts.length,
    postedPeriods: plan.posts.map((p) => p.period),
    updated: plan.writebacks.length,
    skipped: plan.skipped.length,
    blockedNoAccounts: plan.blockedNoAccounts,
  };
}
