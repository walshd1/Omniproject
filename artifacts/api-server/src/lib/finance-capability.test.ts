import { test } from "node:test";
import assert from "node:assert/strict";
import {
  financeCapabilityForRecordType, isFinanceRecordType, financeRecordTypesByCapability,
  FINANCE_CAPABILITY_IDS,
} from "./finance-capability";
import { getCapability, offeredStates, listCapabilities } from "./capability-governance";

/**
 * Finance F0 — the record-type → finance-capability partition, and its five governed capabilities. Each
 * finance record type belongs to exactly one capability; non-finance types are never gated by finance.
 */

test("each finance record type maps to its capability", () => {
  assert.equal(financeCapabilityForRecordType("invoice"), "finance:ar");
  assert.equal(financeCapabilityForRecordType("payment"), "finance:ar");
  assert.equal(financeCapabilityForRecordType("bill"), "finance:ap");
  assert.equal(financeCapabilityForRecordType("vendor"), "finance:ap");
  assert.equal(financeCapabilityForRecordType("gl_account"), "finance:gl");
  assert.equal(financeCapabilityForRecordType("fixed_asset"), "finance:gl");
  assert.equal(financeCapabilityForRecordType("bank_account"), "finance:banking");
  assert.equal(financeCapabilityForRecordType("tax_rate"), "finance:tax");
});

test("a non-finance record type has no finance capability (never gated by finance)", () => {
  for (const t of ["issue", "risk", "project", "task", "wiki_doc", "unknown"]) {
    assert.equal(financeCapabilityForRecordType(t), undefined);
    assert.equal(isFinanceRecordType(t), false);
  }
  assert.equal(isFinanceRecordType("invoice"), true);
});

test("the partition is total + disjoint: every mapped type lands under exactly one of the five ids", () => {
  const grouped = financeRecordTypesByCapability();
  assert.deepEqual(Object.keys(grouped).sort(), [...FINANCE_CAPABILITY_IDS].sort());
  const all = Object.values(grouped).flat();
  assert.equal(new Set(all).size, all.length, "no record type appears twice");
  for (const cap of FINANCE_CAPABILITY_IDS) assert.ok(grouped[cap].length >= 1, `${cap} gates at least one record type`);
  // Every mapped type resolves back to the capability that grouped it.
  for (const cap of FINANCE_CAPABILITY_IDS) for (const t of grouped[cap]) assert.equal(financeCapabilityForRecordType(t), cap);
});

test("the five finance capabilities are governed: kind 'finance', offered states off | user-defined", () => {
  for (const id of FINANCE_CAPABILITY_IDS) {
    const cap = getCapability(id);
    assert.ok(cap, `${id} is in the governance catalogue`);
    assert.equal(cap!.kind, "finance");
    assert.deepEqual(offeredStates(cap!), ["off", "user-defined"]);
  }
  assert.equal(listCapabilities().filter((c) => c.kind === "finance").length, FINANCE_CAPABILITY_IDS.length);
});
