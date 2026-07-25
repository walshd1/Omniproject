import test from "node:test";
import assert from "node:assert/strict";
import { runDepreciationPosting, type BrokerCommandFn } from "./depreciation-effect";
import { DEFAULT_ACCOUNTING, type AccountingConfig } from "./accounting-policy";

const ACCOUNTS: AccountingConfig = {
  ...DEFAULT_ACCOUNTING,
  accounts: { depreciationExpense: "6800", accumulatedDepreciation: "1590", assetCost: "1500", disposalProceeds: "1010", gainLossOnDisposal: "7400" },
};

const ASSET = { id: "FA-1", assetNumber: "FA-1", acquisitionCost: 12000, salvageValue: 0, usefulLifeMonths: 12, depreciationMethod: "straight_line", inServiceDate: "2024-01-31", assetStatus: "in_service" };

/** A fake broker command that serves the asset list, records writes, and reflects the write-back into the record. */
function fakeBroker(assets: Record<string, unknown>[]): { command: BrokerCommandFn; calls: { action: string; payload: Record<string, unknown> }[] } {
  const calls: { action: string; payload: Record<string, unknown> }[] = [];
  const command: BrokerCommandFn = async (action, payload) => {
    calls.push({ action, payload });
    if (action === "list_fixed_assets") return assets;
    if (action === "update_fixed_asset") { // reflect the marker back onto the in-memory record (so a re-run sees it)
      const a = assets.find((x) => x["id"] === payload["id"]);
      if (a) Object.assign(a, payload);
    }
    return null;
  };
  return { command, calls };
}

test("reads assets, posts each due journal, and writes back the advanced marker", async () => {
  const { command, calls } = fakeBroker([{ ...ASSET }]);
  const res = await runDepreciationPosting(command, ACCOUNTS, "2024-03-31");
  assert.equal(res.posted, 2); // Feb + Mar
  assert.deepEqual(res.postedPeriods, ["2024-02-29", "2024-03-31"]);
  const journals = calls.filter((c) => c.action === "create_journal_entry");
  assert.equal(journals.length, 2);
  const wb = calls.find((c) => c.action === "update_fixed_asset")!;
  assert.equal(wb.payload["depreciationThroughDate"], "2024-03-31");
  assert.equal(wb.payload["accumulatedDepreciation"], 2000);
});

test("idempotent: a second run over the same asOf posts nothing (marker was written back)", async () => {
  const assets = [{ ...ASSET }];
  const { command } = fakeBroker(assets);
  await runDepreciationPosting(command, ACCOUNTS, "2024-03-31");
  const second = await runDepreciationPosting(command, ACCOUNTS, "2024-03-31");
  assert.equal(second.posted, 0);
});

test("blocked when GL accounts unset — reads, but posts nothing", async () => {
  const { command, calls } = fakeBroker([{ ...ASSET }]);
  const res = await runDepreciationPosting(command, DEFAULT_ACCOUNTING, "2024-03-31");
  assert.equal(res.blockedNoAccounts, true);
  assert.equal(res.posted, 0);
  assert.equal(calls.filter((c) => c.action === "create_journal_entry").length, 0);
});
